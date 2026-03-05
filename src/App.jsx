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
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
      .from('log_aktivitas')
      .select('*, barang(nama, satuan)')
      .gte('created_at', startOfDay.toISOString())
      .order('created_at', { ascending: false });
    
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
        await supabase.from('barang').update({ stok: item.stok }).eq('id', item.id);
        await supabase.from('log_aktivitas').insert([{
          barang_id: item.id, aksi: selisih > 0 ? 'masuk' : 'keluar',
          jumlah: Math.abs(selisih), stok_sebelum: originalStok.current[item.id] || 0,
          stok_sesudah: item.stok, kasir_nama: currentUser.nama
        }]);
        originalStok.current[item.id] = item.stok;
      }
      setPendingChanges({});
      await fetchDailyLogs(); 
      alert("Database Terupdate! ✅");
      handleLogout();
    } catch (err) { alert("Error: " + err.message); }
  };

  // --- FUNGSI PDF DENGAN STOK OPNAME ---
  const generatePDF = async (mode, days = 0) => {
    try {
      const doc = new jsPDF();
      let startDate = new Date();
      let endDate = new Date();
      endDate.setHours(23, 59, 59, 999);

      if (mode === 'preset') {
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);
      } else {
        startDate = new Date(customDate.start);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(customDate.end);
        endDate.setHours(23, 59, 59, 999);
      }

      const { data: logs } = await supabase.from('log_aktivitas')
        .select('*, barang(nama, satuan)')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .order('created_at', { ascending: false });

      const labelPeriode = mode === 'preset' ? (days === 0 ? "HARI INI" : `${days + 1} HARI TERAKHIR`) : `${customDate.start} s/d ${customDate.end}`;
      
      doc.setFontSize(20); doc.text('LAPORAN GUDANG SANTUY', 14, 20);
      doc.setFontSize(10); doc.text(`Dicetak: ${new Date().toLocaleString('id-ID')}`, 14, 28);
      doc.text(`Periode Laporan: ${labelPeriode}`, 14, 33);

      // TABEL 1: LOG AKTIVITAS
      doc.setFontSize(12); doc.text('1. RIWAYAT AKTIVITAS', 14, 45);
      autoTable(doc, {
        startY: 48,
        head: [['Waktu', 'Barang', 'Oleh', 'Aksi', 'Jumlah', 'Sisa']],
        body: (logs && logs.length > 0) ? logs.map(log => [
          new Date(log.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
          log.barang?.nama || 'Terhapus',
          log.kasir_nama.toUpperCase(),
          log.aksi === 'masuk' ? '+ MASUK' : '- KELUAR',
          `${log.jumlah} ${log.barang?.satuan || ''}`,
          log.stok_sesudah
        ]) : [['-', 'Tidak ada aktivitas tercatat', '-', '-', '-', '-']],
        headStyles: { fillColor: [0, 0, 0] }
      });

      // TABEL 2: STOK OPNAME (Selalu Muncul)
      const nextY = doc.lastAutoTable.finalY + 15;
      doc.setFontSize(12); doc.text('2. STATUS STOK GUDANG (OPNAME)', 14, nextY);
      autoTable(doc, {
        startY: nextY + 3,
        head: [['Nama Barang', 'Kategori', 'Stok Saat Ini', 'Status']],
        body: items.map(i => [
          i.nama.toUpperCase(),
          (i.kategori || 'LAINNYA').toUpperCase(),
          `${i.stok} ${i.satuan}`,
          i.stok <= i.min_stok ? '!!! ORDER' : 'AMAN'
        ]),
        headStyles: { fillColor: [44, 62, 80] }
      });

      doc.save(`Laporan_Gudang_${labelPeriode}.pdf`);
      setShowReportModal(false);
    } catch (err) { alert("Gagal PDF: " + err.message); }
  };

  const sendWA = () => {
    const hariIni = new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    let pesan = `*📦 LAPORAN GUDANG SANTUY*\n_Tanggal: ${hariIni}_\n_Oleh: ${currentUser?.nama.toUpperCase()}_\n\n`;
    
    pesan += `*─── AKTIVITAS HARI INI ───*\n`;
    if (dailyLogs.length > 0) {
      dailyLogs.forEach(log => {
        pesan += `${log.aksi === 'masuk' ? '🟢' : '🔴'} ${log.barang?.nama}: ${log.jumlah} ${log.barang?.satuan} (${log.aksi})\n`;
      });
    } else { pesan += `_(Tidak ada aktivitas)_\n`; }

    pesan += `\n*─── SISA STOK GUDANG ───*\n`;
    items.forEach(i => { pesan += `- ${i.nama}: *${i.stok} ${i.satuan}*\n`; });

    const kritis = items.filter(i => i.stok <= i.min_stok);
    if (kritis.length > 0) {
      pesan += `\n*─── ⚠️ HARUS ORDER ───*\n`;
      kritis.forEach(i => { pesan += `- ${i.nama} (Sisa ${i.stok})\n`; });
    }

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
               <button onClick={handleResetDraft} style={iconBtnStyle('#FF9292')}><RotateCcw color="black"/></button>
               <button onClick={handleSaveAll} style={iconBtnStyle('#FFD600')}><Save color="black"/></button>
            </div>
          )}
          <button onClick={() => setShowAddForm(!showAddForm)} style={iconBtnStyle('#C3FAFF')}><PackagePlus/></button>
          <button onClick={() => setShowReportModal(true)} style={iconBtnStyle('#99E2B4')}><FileText/></button>
        </div>
      </nav>

      {/* MODAL CETAK PDF */}
      <AnimatePresence>
        {showReportModal && (
          <div style={modalOverlay}>
            <motion.div initial={{y:50, opacity:0}} animate={{y:0, opacity:1}} exit={{y:50, opacity:0}} style={modalBox}>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:'20px'}}>
                <h2 style={{fontWeight:900, margin:0}}>CETAK PDF</h2>
                <button onClick={() => setShowReportModal(false)} style={{background:'none', border:'none', cursor:'pointer'}}><X/></button>
              </div>
              <div style={{display:'grid', gap:'10px'}}>
                <button onClick={() => generatePDF('preset', 0)} style={mainBtnStyle('#C3FAFF')}>HARI INI</button>
                <button onClick={() => generatePDF('preset', 6)} style={mainBtnStyle('#99E2B4')}>7 HARI TERAKHIR</button>
                <div style={{border:'3px solid black', padding:'15px', marginTop:'10px'}}>
                  <p style={{fontSize:'0.7rem', fontWeight:900, marginBottom:'10px'}}>CUSTOM TANGGAL:</p>
                  <input type="date" value={customDate.start} onChange={e => setCustomDate({...customDate, start: e.target.value})} style={{...inputStyle, width:'100%', boxSizing:'border-box', marginBottom:'5px'}} />
                  <input type="date" value={customDate.end} onChange={e => setCustomDate({...customDate, end: e.target.value})} style={{...inputStyle, width:'100%', boxSizing:'border-box'}} />
                  <button onClick={() => generatePDF('custom')} style={{...mainBtnStyle('#FFD600'), width:'100%', marginTop:'10px'}}>CETAK RANGE</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div style={quickLookWrapper}>
        <div style={statCard('#C3FAFF')}><span style={statLabel}>TOTAL RAK</span><span style={statValue}>{totalBarang}</span></div>
        <div style={statCard(jmlKritis > 0 ? '#FF9292' : '#99E2B4')}>
          <span style={statLabel}>STOK TIPIS</span><span style={statValue}>{jmlKritis}</span>
          {jmlKritis > 0 && <div style={miniAlertBadge}>ORDER!</div>}
        </div>
        <div style={{...statCard('#FFD600'), gridColumn: 'span 2', height: '140px'}}>
          <span style={statLabel}>AKTIVITAS HARI INI</span>
          <div style={scrollLogWrapper}>
            {dailyLogs.map((log) => (
              <div key={log.id} style={logActivityItem}>
                <span style={{fontWeight:900}}>{log.kasir_nama.split(' ')[0]}</span>
                <span style={{margin:'0 5px'}}>{log.aksi === 'masuk' ? '🟢' : '🔴'}</span>
                <span style={{flex:1, textTransform:'uppercase'}}>{log.barang?.nama} ({log.aksi === 'masuk' ? '+' : '-'}{log.jumlah})</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showAddForm && (
          <motion.form initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} onSubmit={async (e) => {
            e.preventDefault();
            await supabase.from('barang').insert([{ ...newItem, min_stok: parseInt(newItem.min_stok), kategori: newItem.kategori.toUpperCase() || 'LAINNYA' }]);
            setNewItem({ nama: '', satuan: 'pcs', min_stok: 5, kategori: '' }); setShowAddForm(false); fetchBarang();
          }} style={formStyle}>
            <input placeholder="Nama Barang..." value={newItem.nama} onChange={e => setNewItem({...newItem, nama: e.target.value})} style={inputStyle} required />
            <input placeholder="Grup (SNACK, MINUMAN, dll)..." value={newItem.kategori} onChange={e => setNewItem({...newItem, kategori: e.target.value})} style={inputStyle} />
            <div style={{display:'flex', gap:'10px'}}><input placeholder="Satuan" value={newItem.satuan} onChange={e => setNewItem({...newItem, satuan: e.target.value})} style={{...inputStyle, flex:1}} /><input type="number" placeholder="Min" value={newItem.min_stok} onChange={e => setNewItem({...newItem, min_stok: e.target.value})} style={{...inputStyle, width:'80px'}} /></div>
            <button type="submit" style={mainBtnStyle('#99E2B4')}>TAMBAH KE GUDANG</button>
          </motion.form>
        )}
      </AnimatePresence>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
        {Object.entries(groupedItems).map(([kategori, barangSekawan]) => (
          <div key={kategori}>
            <div style={categoryHeaderStyle}><span style={categoryTitleStyle}>{kategori}</span><div style={categoryLineStyle}></div></div>
            <div style={gridStyle}>
              {barangSekawan.map(item => (
                <motion.div layout key={item.id} style={cardStyle(item.stok <= item.min_stok, pendingChanges[item.id])}>
                  <div style={{display:'flex', justifyContent:'space-between', marginBottom:'8px'}}>
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
const miniInputGroup = { fontSize: '0.6rem', fontWeight: '900', border: '2px solid black', padding: '2px 5px', backgroundColor: '#EEE', width: '60px', textAlign: 'center' };
const itemTitle = { fontSize: '1.1rem', fontWeight: '900', margin: '10px 0 5px 0', textTransform: 'uppercase' };
const stokDisplay = { fontSize: '3.5rem', fontWeight: '900', letterSpacing: '-3px', margin: '10px 0' };
const btnGroupCard = { display: 'flex', gap: '8px' };
const actionBtnStyle = (bg) => ({ flex: 1, height: '45px', border: '3px solid black', backgroundColor: bg, boxShadow: '3px 3px 0px black', cursor: 'pointer' });
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
const scrollLogWrapper = { marginTop: '10px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px', height: '80px' };
const logActivityItem = { display: 'flex', alignItems: 'center', fontSize: '0.65rem', padding: '5px', backgroundColor: 'rgba(255,255,255,0.4)', border: '2px solid black' };
const modalOverlay = { position:'fixed', top:0, left:0, right:0, bottom:0, backgroundColor:'rgba(0,0,0,0.8)', display:'flex', justifyContent:'center', alignItems:'center', zIndex:1000 };
const modalBox = { backgroundColor:'white', border:'5px solid black', padding:'30px', boxShadow:'15px 15px 0px black', width:'90%', maxWidth:'400px' };
