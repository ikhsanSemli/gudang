import { useEffect, useState, useRef } from 'react';
import { supabase } from './supabaseClient';
import { 
  Plus, Minus, History, X, PackagePlus, AlertCircle, 
  LogOut, FileText, Save, RotateCcw, MessageCircle 
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function App() {
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [history, setHistory] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [newItem, setNewItem] = useState({ nama: '', satuan: 'pcs', min_stok: 5, kategori: '' });
  const [customDate, setCustomDate] = useState({ 
    start: new Date().toISOString().split('T')[0], 
    end: new Date().toISOString().split('T')[0] 
  });
  
  const [currentUser, setCurrentUser] = useState(null);
  const [daftarKasir, setDaftarKasir] = useState([]);
  const [dailyLogs, setDailyLogs] = useState([]); 

  const [pendingChanges, setPendingChanges] = useState({}); 
  const originalStok = useRef({}); 

  // --- LOGIKA QUICK LOOK ---
  const totalBarang = items.length;
  const jmlKritis = items.filter(i => i.stok <= i.min_stok).length;

  useEffect(() => { 
    fetchBarang(); 
    fetchKasir();
    fetchDailyLogs();
    const savedUser = localStorage.getItem('gudang_user');
    if (savedUser) setCurrentUser(JSON.parse(savedUser));
  }, []);

  const fetchBarang = async () => {
    const { data, error } = await supabase.from('barang').select('*').order('nama');
    if (error) console.error("Error Fetch Barang:", error);
    const safeData = data || [];
    setItems(safeData);
    safeData.forEach(item => {
        originalStok.current[item.id] = item.stok;
    });
  };

  const fetchKasir = async () => {
    const { data } = await supabase.from('kasir').select('*');
    setDaftarKasir(data || []);
  };

  const fetchDailyLogs = async () => {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('log_aktivitas')
      .select('*, barang(nama, satuan)')
      .gte('created_at', today)
      .order('created_at', { ascending: false }); // Terbaru di atas
    
    if (error) console.error("Error Fetch Logs:", error);
    setDailyLogs(data || []);
  };

  const handleLogin = (kasir) => {
    setCurrentUser(kasir);
    localStorage.setItem('gudang_user', JSON.stringify(kasir));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('gudang_user');
  };

  const updateKategori = async (id, kategoriBaru) => {
    const formattedCat = kategoriBaru.toUpperCase() || 'LAINNYA';
    try {
      const { error } = await supabase.from('barang').update({ kategori: formattedCat }).eq('id', id);
      if (error) throw error;
      fetchBarang(); 
    } catch (err) { alert("Gagal ganti grup: " + err.message); }
  };

  const updateStokLokal = (item, perubahan) => {
    if (!currentUser) return alert("Pilih namamu dulu!");
    setItems(prevItems => {
      const newItems = prevItems.map(i => {
        if (i.id === item.id) {
          const stokBaru = i.stok + perubahan;
          return stokBaru >= 0 ? { ...i, stok: stokBaru } : i;
        }
        return i;
      });
      const itemBaru = newItems.find(i => i.id === item.id);
      if (itemBaru) {
          const selisihTotal = itemBaru.stok - (originalStok.current[item.id] || 0);
          setPendingChanges(prev => ({ ...prev, [item.id]: selisihTotal }));
      }
      return newItems;
    });
  };

  const handleResetDraft = () => {
    setItems(prev => prev.map(item => ({
      ...item,
      stok: originalStok.current[item.id] !== undefined ? originalStok.current[item.id] : item.stok
    })));
    setPendingChanges({});
  };

  const handleSaveAll = async () => {
    const ids = Object.keys(pendingChanges).filter(id => pendingChanges[id] !== 0);
    if (ids.length === 0) return alert("Gak ada perubahan.");
    try {
      for (const id of ids) {
        const selisih = pendingChanges[id];
        const item = items.find(i => String(i.id) === String(id));
        if (!item) continue;
        const { data: updateRes, error: errUpdate } = await supabase.from('barang').update({ stok: item.stok }).eq('id', item.id).select();
        if (errUpdate) throw new Error(`Update Gagal: ${errUpdate.message}`);
        const { error: errLog } = await supabase.from('log_aktivitas').insert([{
          barang_id: item.id, aksi: selisih > 0 ? 'masuk' : 'keluar',
          jumlah: Math.abs(selisih), stok_sebelum: originalStok.current[item.id] || 0,
          stok_sesudah: item.stok, kasir_nama: currentUser.nama
        }]);
        if (errLog) throw new Error(`Catat Log Gagal: ${errLog.message}`);
        originalStok.current[item.id] = item.stok;
      }
      setPendingChanges({});
      await fetchDailyLogs(); 
      alert("Mantap! Database sudah terupdate. ✅");
      handleLogout();
    } catch (err) { alert("⚠️ WADUH: " + err.message); }
  };

  const generatePDF = async (mode, days = 0) => {
    try {
      const doc = new jsPDF();
      let startDate, endDate;
      if (mode === 'preset') {
        startDate = new Date(); startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0); endDate = new Date();
      } else {
        startDate = new Date(customDate.start); startDate.setHours(0, 0, 0, 0);
        endDate = new Date(customDate.end); endDate.setHours(23, 59, 59, 999);
      }
      const { data: logs } = await supabase.from('log_aktivitas').select('*, barang(nama, satuan)')
        .gte('created_at', startDate.toISOString()).lte('created_at', endDate.toISOString()).order('created_at', { ascending: false });
      const labelPeriode = mode === 'preset' ? (days === 0 ? "HARI INI" : `${days + 1} HARI TERAKHIR`) : `${customDate.start} sd ${customDate.end}`;
      doc.setFontSize(18); doc.text('LAPORAN GUDANG LENGKAP', 14, 15);
      if (logs && logs.length > 0) {
        autoTable(doc, {
          startY: 42,
          head: [['Waktu', 'Barang', 'Oleh', 'Aksi', 'Jumlah', 'Sisa']],
          body: logs.map(log => [
            new Date(log.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
            log.barang?.nama || 'Terhapus', log.kasir_nama.toUpperCase(), log.aksi === 'masuk' ? '+ MASUK' : '- KELUAR',
            `${log.jumlah} ${log.barang?.satuan || ''}`, log.stok_sesudah
          ]),
          headStyles: { fillColor: [44, 62, 80] }
        });
      }
      doc.save(`Laporan_${labelPeriode}.pdf`);
      setShowReportModal(false);
    } catch (err) { alert("Gagal cetak PDF: " + err.message); }
  };

  const sendWA = () => {
    let pesan = `*LAPORAN GUDANG SANTUY*\nOleh: ${currentUser?.nama || 'Admin'}\n\n`;
    items.forEach(item => {
      pesan += `- ${item.nama}: *Sisa ${item.stok} ${item.satuan}*\n`;
    });
    window.open(`https://wa.me/?text=${encodeURIComponent(pesan)}`, '_blank');
  };

  const groupedItems = items.reduce((acc, item) => {
    const cat = (item.kategori || 'LAINNYA').toUpperCase();
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  const bukaDetail = async (item) => {
    setSelectedItem(item);
    const { data } = await supabase.from('log_aktivitas').select('*').eq('barang_id', item.id).order('created_at', { ascending: false }).limit(20);
    setHistory(data || []);
  };

  if (!currentUser) {
    return (
      <div style={loginWrapper}>
        <motion.div initial={{scale:0.9, opacity:0}} animate={{scale:1, opacity:1}} style={loginCard}>
          <h1 style={{...logoStyle, textAlign:'center', marginBottom:'20px'}}>SIAPA<br/>KAMU?</h1>
          <div style={{display:'grid', gap:'10px'}}>
            {daftarKasir.map(k => (
              <button key={k.id} onClick={() => handleLogin(k)} style={mainBtnStyle('#C3FAFF')}>{k.nama.toUpperCase()}</button>
            ))}
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div style={layoutStyle}>
      <nav style={navStyle}>
        <div>
          <h1 style={logoStyle}>GUDANG<br/>SANTUY</h1>
          <div style={{display:'flex', alignItems:'center', gap:'5px', marginTop:'5px'}}>
            <div style={badgeStyle}>{currentUser.nama.toUpperCase()}</div>
            <button onClick={handleLogout} style={logoutBtn}><LogOut size={12}/></button>
          </div>
        </div>
        <div style={navGroupBtn}>
          <button onClick={sendWA} style={iconBtnStyle('#25D366')}><MessageCircle/></button>
          {Object.values(pendingChanges).some(v => v !== 0) && (
            <div style={{display:'flex', gap:'8px'}}>
               <motion.button onClick={handleResetDraft} style={iconBtnStyle('#FF9292')}><RotateCcw color="black"/></motion.button>
               <motion.button onClick={handleSaveAll} style={iconBtnStyle('#FFD600')}><Save color="black"/></motion.button>
            </div>
          )}
          <button onClick={() => setShowAddForm(!showAddForm)} style={iconBtnStyle('#C3FAFF')}><PackagePlus/></button>
          <button onClick={() => setShowReportModal(true)} style={iconBtnStyle('#99E2B4')}><FileText/></button>
        </div>
      </nav>

      {/* DASHBOARD RINGKAS - DIPERBARUI */}
      <div style={quickLookWrapper}>
        <motion.div whileHover={{ y: -5 }} style={statCard('#C3FAFF')}>
          <span style={statLabel}>TOTAL BARANG</span>
          <span style={statValue}>{totalBarang}</span>
        </motion.div>
        
        <motion.div whileHover={{ y: -5 }} style={statCard(jmlKritis > 0 ? '#FF9292' : '#99E2B4')}>
          <span style={statLabel}>STOK KRITIS</span>
          <span style={statValue}>{jmlKritis}</span>
          {jmlKritis > 0 && <div style={miniAlertBadge}>ORDER!</div>}
        </motion.div>

        {/* SECTION AKTIVITAS REAL-TIME */}
        <motion.div style={{...statCard('#FFD600'), gridColumn: 'span 2', height: '160px'}}>
          <span style={statLabel}>AKTIVITAS HARI INI ({dailyLogs.length})</span>
          <div style={scrollLogWrapper}>
            <AnimatePresence initial={false}>
              {dailyLogs.length > 0 ? (
                dailyLogs.map((log) => (
                  <motion.div 
                    key={log.id} 
                    initial={{ opacity: 0, x: -20 }} 
                    animate={{ opacity: 1, x: 0 }} 
                    style={logActivityItem}
                  >
                    <span style={{fontWeight: '900'}}>{log.kasir_nama.split(' ')[0]}</span>
                    <span style={{margin: '0 5px'}}>{log.aksi === 'masuk' ? '🟢' : '🔴'}</span>
                    <span style={{flex: 1, textTransform: 'uppercase'}}>{log.barang?.nama} ({log.aksi === 'masuk' ? '+' : '-'}{log.jumlah})</span>
                    <span style={{fontSize: '0.6rem', opacity: 0.5}}>
                      {new Date(log.created_at).toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'})}
                    </span>
                  </motion.div>
                ))
              ) : (
                <div style={{fontSize: '0.7rem', textAlign: 'center', marginTop: '20px', opacity: 0.5}}>Belum ada pergerakan hari ini</div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {showAddForm && (
          <motion.form initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} onSubmit={async (e) => {
            e.preventDefault();
            const { error } = await supabase.from('barang').insert([{ ...newItem, min_stok: parseInt(newItem.min_stok), kategori: newItem.kategori.toUpperCase() || 'LAINNYA' }]);
            if (!error) { setNewItem({ nama: '', satuan: 'pcs', min_stok: 5, kategori: '' }); setShowAddForm(false); fetchBarang(); }
          }} style={formStyle}>
            <input placeholder="Nama Barang..." value={newItem.nama} onChange={e => setNewItem({...newItem, nama: e.target.value})} style={inputStyle} required />
            <input placeholder="Grup..." value={newItem.kategori} onChange={e => setNewItem({...newItem, kategori: e.target.value})} style={inputStyle} />
            <div style={{display:'flex', gap:'10px'}}><input placeholder="Satuan" value={newItem.satuan} onChange={e => setNewItem({...newItem, satuan: e.target.value})} style={{...inputStyle, flex:1}} /><input type="number" placeholder="Min" value={newItem.min_stok} onChange={e => setNewItem({...newItem, min_stok: e.target.value})} style={{...inputStyle, width:'80px'}} /></div>
            <button type="submit" style={mainBtnStyle('#99E2B4')}>TAMBAH RAK</button>
          </motion.form>
        )}
      </AnimatePresence>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '50px' }}>
        {Object.entries(groupedItems).map(([kategori, barangSekawan]) => (
          <div key={kategori}>
            <div style={categoryHeaderStyle}><span style={categoryTitleStyle}>{kategori}</span><div style={categoryLineStyle}></div></div>
            <div style={gridStyle}>
              {barangSekawan.map(item => (
                <motion.div layout key={item.id} style={cardStyle(item.stok <= item.min_stok, pendingChanges[item.id])}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'8px'}}>
                     <input defaultValue={item.kategori} onBlur={(e) => updateKategori(item.id, e.target.value)} style={miniInputGroup} />
                     <button onClick={() => bukaDetail(item)} style={historyBtn}><History size={14}/></button>
                  </div>
                  <h2 style={itemTitle}>{item.nama}</h2>
                  <div style={stokDisplay}>{item.stok}</div>
                  <div style={btnGroupCard}><button onClick={() => updateStokLokal(item, -1)} style={actionBtnStyle('#FF9292')}><Minus/></button><button onClick={() => updateStokLokal(item, 1)} style={actionBtnStyle('#99E2B4')}><Plus/></button></div>
                  {pendingChanges[item.id] !== 0 && pendingChanges[item.id] !== undefined && <div style={pendingLabel}>DRAFT</div>}
                  {item.stok <= item.min_stok && <div style={alertSticker}><AlertCircle size={12}/> ORDER!</div>}
                </motion.div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// STYLES 
const layoutStyle = { padding: '20px', maxWidth: '800px', margin: 'auto', minHeight: '100vh', backgroundColor: '#FFFDF0', fontFamily: 'sans-serif' };
const navStyle = { display: 'flex', justifyContent: 'space-between', marginBottom: '20px' };
const logoStyle = { fontSize: '2.5rem', fontWeight: '900', lineHeight: '0.8', margin: 0 };
const badgeStyle = { backgroundColor: 'black', color: 'white', padding: '2px 8px', fontSize: '0.6rem', fontWeight: 'bold' };
const logoutBtn = { border:'2px solid black', background:'white', cursor:'pointer', padding:'2px 5px' };
const loginWrapper = { display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', backgroundColor:'#FFFDF0' };
const loginCard = { border:'4px solid black', padding:'40px', backgroundColor:'white', boxShadow:'15px 15px 0px black' };
const navGroupBtn = { display: 'flex', gap: '10px' };
const iconBtnStyle = (bg) => ({ width: '50px', height: '50px', border: '3px solid black', boxShadow: '4px 4px 0px black', backgroundColor: bg, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' });
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '20px' };
const cardStyle = (low, isPending) => ({ padding: '15px', border: '4px solid black', boxShadow: isPending ? '8px 8px 0px #FFD600' : '8px 8px 0px black', backgroundColor: low ? '#FFD1D1' : 'white', position: 'relative' });
const categoryHeaderStyle = { display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '20px', marginTop: '10px' };
const categoryTitleStyle = { fontSize: '1.1rem', fontWeight: '900', backgroundColor: 'black', color: 'white', padding: '5px 15px', transform: 'skewX(-10deg)' };
const categoryLineStyle = { flex: 1, height: '4px', backgroundColor: 'black' };
const miniInputGroup = { fontSize: '0.6rem', fontWeight: '900', border: '2px solid black', padding: '2px 5px', backgroundColor: '#EEE', width: '60px', textAlign: 'center', outline: 'none' };
const itemTitle = { fontSize: '1.1rem', fontWeight: '900', margin: '10px 0 5px 0', textTransform: 'uppercase' };
const stokDisplay = { fontSize: '3.5rem', fontWeight: '900', letterSpacing: '-3px', margin: '10px 0' };
const btnGroupCard = { display: 'flex', gap: '8px' };
const actionBtnStyle = (bg) => ({ flex: 1, height: '45px', border: '3px solid black', backgroundColor: bg, boxShadow: '3px 3px 0px black', cursor: 'pointer', fontWeight:'bold' });
const pendingLabel = { position:'absolute', top:'-10px', left:'50%', transform:'translateX(-50%)', backgroundColor:'#FFD600', border:'2px solid black', fontSize:'0.5rem', fontWeight:'bold', padding:'2px 5px' };
const alertSticker = { position: 'absolute', bottom: '-10px', right: '-10px', backgroundColor: '#FFD600', border: '3px solid black', padding: '4px 8px', fontSize: '0.7rem', fontWeight: '900', transform: 'rotate(-5deg)' };
const formStyle = { border: '4px solid black', padding: '20px', marginBottom: '30px', backgroundColor: 'white', boxShadow: '10px 10px 0px black', display: 'flex', flexDirection: 'column', gap: '12px' };
const inputStyle = { padding: '12px', border: '3px solid black', fontWeight: 'bold' };
const mainBtnStyle = (bg) => ({ padding: '15px', border: '3px solid black', backgroundColor: bg, fontWeight: '900', cursor: 'pointer', boxShadow: '5px 5px 0px black' });
const historyBtn = { background: 'none', border: '2px solid black', cursor: 'pointer', padding: '3px' };
const quickLookWrapper = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '40px' };
const statCard = (bg) => ({ padding: '15px', border: '4px solid black', backgroundColor: bg, boxShadow: '6px 6px 0px black', display: 'flex', flexDirection: 'column', position: 'relative' });
const statLabel = { fontSize: '0.6rem', fontWeight: '900', letterSpacing: '1px' };
const statValue = { fontSize: '2rem', fontWeight: '900', lineHeight: '1' };
const miniAlertBadge = { position: 'absolute', top: '-10px', right: '-10px', backgroundColor: 'black', color: 'white', fontSize: '0.5rem', padding: '2px 6px', fontWeight: 'bold' };

// NEW STYLES FOR DYNAMIC DASHBOARD
const scrollLogWrapper = { marginTop: '10px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px', paddingRight: '5px', height: '100%', scrollbarWidth: 'none' };
const logActivityItem = { display: 'flex', alignItems: 'center', fontSize: '0.7rem', padding: '5px 8px', backgroundColor: 'rgba(255,255,255,0.4)', border: '2px solid black', boxShadow: '2px 2px 0px black' };