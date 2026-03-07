import { useEffect, useState, useRef } from 'react';
import { supabase } from './supabaseClient';
import { 
  Plus, Minus, History, X, PackagePlus, AlertCircle, 
  LogOut, FileText, Save, RotateCcw, MessageCircle, Clock, ArrowUpRight, ArrowDownLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function App() {
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [history, setHistory] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [newItem, setNewItem] = useState({ nama: '', satuan: 'pcs', min_stok: 5, kategori: '', stok: 0 });
  const [customDate, setCustomDate] = useState({ 
    start: new Date().toISOString().split('T')[0], 
    end: new Date().toISOString().split('T')[0] 
  });
  const [currentUser, setCurrentUser] = useState(null);
  const [daftarKasir, setDaftarKasir] = useState([]);
  const [dailyLogs, setDailyLogs] = useState([]); 
  const [pendingChanges, setPendingChanges] = useState({}); 
  const originalStok = useRef({}); 

  useEffect(() => { 
    fetchBarang(); 
    fetchKasir();
    fetchDailyLogs();
    const savedUser = localStorage.getItem('gudang_user');
    if (savedUser) setCurrentUser(JSON.parse(savedUser));
  }, []);

  const fetchBarang = async () => {
    const { data } = await supabase.from('barang').select('*').order('nama');
    const safeData = data || [];
    setItems(safeData);
    safeData.forEach(item => { originalStok.current[item.id] = item.stok; });
  };

  const fetchKasir = async () => {
    const { data } = await supabase.from('kasir').select('*');
    setDaftarKasir(data || []);
  };

  const fetchDailyLogs = async () => {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase.from('log_aktivitas').select('*, barang(nama, satuan)')
      .gte('created_at', today).order('created_at', { ascending: false });
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
      await supabase.from('barang').update({ kategori: formattedCat }).eq('id', id);
      fetchBarang(); 
    } catch (err) { console.error(err); }
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

  const handleReset = () => {
    if (confirm("Batalkan semua perubahan stok?")) {
      setPendingChanges({});
      fetchBarang();
    }
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
      alert("Tersimpan! ✅");
      handleLogout();
    } catch (err) { alert("Error: " + err.message); }
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
        .gte('created_at', startDate.toISOString()).lte('created_at', endDate.toISOString());
      const labelPeriode = mode === 'preset' ? (days === 0 ? "HARI INI" : `${days + 1} HARI TERAKHIR`) : `${customDate.start} sd ${customDate.end}`;
      doc.setFontSize(18); doc.text('LAPORAN MUTASI GUDANG', 14, 20);
      doc.setFontSize(10); doc.text(`Periode: ${labelPeriode} | Admin: ${currentUser.nama.toUpperCase()}`, 14, 27);
      
      const mutasiBody = items.map((item, idx) => {
        const itemLogs = logs?.filter(l => l.barang_id === item.id) || [];
        const masuk = itemLogs.filter(l => l.aksi === 'masuk').reduce((sum, l) => sum + l.jumlah, 0);
        const keluar = itemLogs.filter(l => l.aksi === 'keluar').reduce((sum, l) => sum + l.jumlah, 0);
        return [idx+1, item.nama.toUpperCase(), `+${masuk}`, `-${keluar}`, item.stok, item.stok <= item.min_stok ? 'RE-STOCK' : 'AMAN'];
      });

      autoTable(doc, {
        startY: 35,
        head: [['No', 'Barang', 'Masuk', 'Keluar', 'Sisa', 'Status']],
        body: mutasiBody,
        theme: 'grid',
        headStyles: { fillColor: [44, 62, 80] },
        didDrawCell: (data) => {
          if (data.section === 'body' && data.column.index === 5) {
             if (data.cell.raw === 'RE-STOCK') doc.setTextColor(200, 0, 0);
             else doc.setTextColor(0, 150, 0);
          }
        }
      });
      doc.save(`Laporan_${labelPeriode}.pdf`);
      setShowReportModal(false);
    } catch (err) { alert("Gagal PDF: " + err.message); }
  };

  const sendWA = () => {
    const hariIni = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
    let pesan = `*📦 LAPORAN GUDANG SANTUY*\n_Tanggal: ${hariIni}_\n\n`;
    pesan += `*─── AKTIVITAS HARI INI ───*\n`;
    if (dailyLogs.length > 0) {
      dailyLogs.forEach(l => { pesan += `${l.aksi === 'masuk' ? '🟢' : '🔴'} ${l.barang?.nama}: ${l.jumlah}\n`; });
    } else { pesan += `_Tidak ada aktivitas_\n`; }
    pesan += `\n*─── SISA STOK ───*\n`;
    items.forEach(i => { pesan += `- ${i.nama}: *${i.stok}*\n`; });
    const kritis = items.filter(i => i.stok <= i.min_stok);
    if (kritis.length > 0) {
      pesan += `\n*─── ⚠️ DAFTAR BELANJA ───*\n`;
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

  const itemsLimit = items.filter(i => i.stok <= i.min_stok);

  if (!currentUser) {
    return (
      <div style={loginWrapper}>
        <div style={loginCard}>
          <h1 style={{textAlign:'center', fontWeight:900}}>GUDANG SANTUY</h1>
          <div style={{display:'grid', gap:'10px', marginTop:'20px'}}>
            {daftarKasir.map(k => (
              <button key={k.id} onClick={() => handleLogin(k)} style={mainBtnStyle('#C3FAFF')}>{k.nama.toUpperCase()}</button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={layoutStyle}>
      <nav style={navStyle}>
        <div><h1 style={logoStyle}>GUDANG<br/>SANTUY</h1><div style={badgeStyle}>{currentUser.nama.toUpperCase()}</div></div>
        <div style={{display:'flex', gap:'8px'}}>
          <button onClick={sendWA} title="Kirim WA" style={iconBtnStyle('#25D366')}><MessageCircle/></button>
          <button onClick={() => setShowAddForm(!showAddForm)} style={iconBtnStyle('#C3FAFF')}><PackagePlus/></button>
          <button onClick={() => setShowReportModal(true)} style={iconBtnStyle('#99E2B4')}><FileText/></button>
          <button onClick={handleLogout} style={iconBtnStyle('#FF9292')}><LogOut/></button>
        </div>
      </nav>

      <div style={quickLookWrapper}>
        <div style={statCard('#C3FAFF')}>
            <span style={statLabel}>TOTAL BARANG</span>
            <span style={statValue}>{items.length}</span>
        </div>
        <div style={statCard(itemsLimit.length > 0 ? '#FF9292' : '#99E2B4')}>
          <span style={statLabel}>⚠️ LIMIT ORDER</span>
          <span style={statValue}>{itemsLimit.length}</span>
          <div style={limitBadgeContainer}>
            {itemsLimit.length > 0 ? itemsLimit.map(i => (
                <span key={i.id} style={limitBadge}>{i.nama} ({i.stok})</span>
            )) : <span style={{fontSize:'0.6rem'}}>Aman bos!</span>}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showAddForm && (
          <motion.form initial={{opacity:0, y:-10}} animate={{opacity:1, y:0}} onSubmit={async (e) => {
            e.preventDefault();
            await supabase.from('barang').insert([{ ...newItem, kategori: newItem.kategori.toUpperCase() || 'LAINNYA', stok: parseInt(newItem.stok), min_stok: parseInt(newItem.min_stok) }]);
            setNewItem({ nama: '', satuan: 'pcs', min_stok: 5, kategori: '', stok: 0 }); setShowAddForm(false); fetchBarang();
          }} style={formStyle}>
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:'10px'}}><b>TAMBAH BARANG BARU</b> <X onClick={()=>setShowAddForm(false)} style={{cursor:'pointer'}}/></div>
            <input placeholder="Nama Barang" value={newItem.nama} onChange={e => setNewItem({...newItem, nama: e.target.value})} style={inputStyle} required />
            <div style={{display:'flex', gap:'5px'}}>
                <input placeholder="Kategori" value={newItem.kategori} onChange={e => setNewItem({...newItem, kategori: e.target.value})} style={{...inputStyle, flex:2}} />
                <input placeholder="Satuan" value={newItem.satuan} onChange={e => setNewItem({...newItem, satuan: e.target.value})} style={{...inputStyle, flex:1}} />
            </div>
            <div style={{display:'flex', gap:'10px'}}>
               <div style={{flex:1}}><label style={miniLabel}>STOK AWAL</label><input type="number" value={newItem.stok} onChange={e => setNewItem({...newItem, stok: e.target.value})} style={inputStyle} /></div>
               <div style={{flex:1}}><label style={miniLabel}>LIMIT</label><input type="number" value={newItem.min_stok} onChange={e => setNewItem({...newItem, min_stok: e.target.value})} style={inputStyle} /></div>
            </div>
            <button type="submit" style={mainBtnStyle('#99E2B4')}>TAMBAHKAN</button>
          </motion.form>
        )}
      </AnimatePresence>

      <div style={{marginBottom:'40px'}}>
        {Object.entries(groupedItems).map(([kategori, list]) => (
            <div key={kategori} style={{marginBottom:'25px'}}>
            <div style={categoryHeader}><span style={categoryTag}>{kategori}</span><div style={categoryLine}></div></div>
            <div style={gridStyle}>
                {list.map(item => (
                <div key={item.id} style={cardStyle(item.stok <= item.min_stok, pendingChanges[item.id])}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                        <input defaultValue={item.kategori} onBlur={(e) => updateKategori(item.id, e.target.value)} style={miniInput} />
                        <button onClick={async () => {
                            setSelectedItem(item);
                            const {data} = await supabase.from('log_aktivitas').select('*').eq('barang_id', item.id).order('created_at', { ascending: false }).limit(5);
                            setHistory(data || []);
                        }} style={iconSmall}><History size={14}/></button>
                    </div>
                    <h2 style={itemTitle}>{item.nama}</h2>
                    <div style={stokWrapper}>
                        <div style={stokDisplay}>{item.stok}</div>
                        <span style={{fontSize:'0.6rem', fontWeight:900}}>{item.satuan}</span>
                    </div>
                    {pendingChanges[item.id] !== undefined && pendingChanges[item.id] !== 0 && (
                        <div style={originalInfo}>Ori: {originalStok.current[item.id]}</div>
                    )}
                    <div style={{display:'flex', gap:'5px', marginTop:'5px'}}>
                        <button onClick={() => updateStokLokal(item, -1)} style={actionBtn('#FF9292')}><Minus/></button>
                        <button onClick={() => updateStokLokal(item, 1)} style={actionBtn('#99E2B4')}><Plus/></button>
                    </div>
                    {item.stok <= item.min_stok && <div style={alertSticker}>ORDER!</div>}
                </div>
                ))}
            </div>
            </div>
        ))}
      </div>

      {/* WIDGET LOG HARIAN DI BAWAH (DIPERCANTIK) */}
      <div style={logSection}>
        <div style={{display:'flex', alignItems:'center', gap:'10px', marginBottom:'15px'}}>
            <Clock size={20}/>
            <h3 style={{margin:0, fontWeight:900}}>AKTIVITAS HARI INI</h3>
        </div>
        <div style={logContainer}>
            {dailyLogs.length > 0 ? dailyLogs.map(log => (
                <div key={log.id} style={logCard}>
                    <div style={logIcon(log.aksi)}>{log.aksi === 'masuk' ? <ArrowUpRight size={14}/> : <ArrowDownLeft size={14}/>}</div>
                    <div style={{flex:1}}>
                        <div style={logText}><b>{log.barang?.nama}</b></div>
                        <div style={logMeta}>{log.kasir_nama.toUpperCase()} • {new Date(log.created_at).toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'})}</div>
                    </div>
                    <div style={logQty(log.aksi)}>{log.aksi === 'masuk' ? '+' : '-'}{log.jumlah}</div>
                </div>
            )) : <div style={{textAlign:'center', padding:'20px', fontSize:'0.7rem'}}>Belum ada aktivitas.</div>}
        </div>
      </div>

      {/* FLOATING BAR */}
      {Object.values(pendingChanges).some(v => v !== 0) && (
        <div style={saveBar}>
          <button onClick={handleReset} style={resetBtn}><RotateCcw/></button>
          <button onClick={handleSaveAll} style={saveBtn}><Save size={20}/> SIMPAN SEMUA</button>
        </div>
      )}

      {/* MODAL PDF */}
      <AnimatePresence>
        {showReportModal && (
          <div style={modalOverlay} onClick={() => setShowReportModal(false)}>
            <motion.div initial={{scale:0.9}} animate={{scale:1}} style={modalBox} onClick={e => e.stopPropagation()}>
              <h2 style={{fontWeight:900, marginBottom:'15px'}}>CETAK PDF</h2>
              <button onClick={() => generatePDF('preset', 0)} style={mainBtnStyle('#C3FAFF')}>HARI INI</button>
              <button onClick={() => generatePDF('preset', 6)} style={mainBtnStyle('#99E2B4')}>7 HARI TERAKHIR</button>
              <button onClick={() => setShowReportModal(false)} style={mainBtnStyle('#eee')}>BATAL</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL HISTORY */}
      <AnimatePresence>
        {selectedItem && (
          <div style={modalOverlay} onClick={() => setSelectedItem(null)}>
            <motion.div initial={{y:50}} animate={{y:0}} style={modalBox} onClick={e => e.stopPropagation()}>
               <h3 style={{margin:0, borderBottom:'3px solid black'}}>{selectedItem.nama.toUpperCase()}</h3>
               <div style={{maxHeight:'200px', overflowY:'auto', marginTop:'10px'}}>
                  {history.map(h => (
                    <div key={h.id} style={{fontSize:'0.7rem', padding:'8px', borderBottom:'1px solid black', display:'flex', justifyContent:'space-between'}}>
                      <span>{new Date(h.created_at).toLocaleDateString()}</span>
                      <b>{h.aksi.toUpperCase()} {h.jumlah}</b>
                    </div>
                  ))}
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- STYLES (BRUTALISM EVOLVED) ---
const layoutStyle = { padding: '20px', maxWidth: '600px', margin: 'auto', backgroundColor: '#FFFDF0', minHeight: '100vh', fontFamily: 'monospace' };
const navStyle = { display: 'flex', justifyContent: 'space-between', marginBottom: '30px' };
const logoStyle = { fontSize: '1.8rem', fontWeight: 900, lineHeight: 0.8 };
const badgeStyle = { backgroundColor: 'black', color: 'white', display: 'inline-block', padding: '2px 8px', fontSize: '0.6rem', fontWeight: 900, marginTop:'5px' };
const iconBtnStyle = (bg) => ({ width: '45px', height: '45px', border: '3px solid black', backgroundColor: bg, boxShadow: '3px 3px 0px black', cursor: 'pointer', display:'flex', alignItems:'center', justifyContent:'center' });

const quickLookWrapper = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '25px' };
const statCard = (bg) => ({ padding: '12px', border: '4px solid black', backgroundColor: bg, boxShadow: '5px 5px 0px black' });
const statLabel = { fontSize: '0.6rem', fontWeight: 900, display:'block' };
const statValue = { fontSize: '2.2rem', fontWeight: 900, lineHeight:1 };
const limitBadgeContainer = { display:'flex', flexWrap:'wrap', gap:'4px', marginTop:'8px', maxHeight:'60px', overflowY:'auto' };
const limitBadge = { backgroundColor:'rgba(255,255,255,0.6)', border:'1px solid black', padding:'2px 4px', fontSize:'0.5rem', fontWeight:900 };

const logSection = { marginTop: '20px', paddingBottom: '100px' };
const logContainer = { display:'grid', gap:'8px' };
const logCard = { display:'flex', alignItems:'center', gap:'10px', padding:'10px', backgroundColor:'white', border:'3px solid black', boxShadow:'3px 3px 0px black' };
const logIcon = (aksi) => ({ width:'25px', height:'25px', borderRadius:'50%', border:'2px solid black', display:'flex', alignItems:'center', justifyContent:'center', backgroundColor: aksi === 'masuk' ? '#99E2B4' : '#FF9292' });
const logText = { fontSize:'0.75rem', lineHeight:1 };
const logMeta = { fontSize:'0.55rem', color:'#666' };
const logQty = (aksi) => ({ fontWeight:900, color: aksi === 'masuk' ? '#008529' : '#C40000' });

const categoryHeader = { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' };
const categoryTag = { backgroundColor: 'black', color: 'white', padding: '2px 10px', fontWeight: 900, fontSize: '0.75rem' };
const categoryLine = { flex: 1, height: '3px', backgroundColor: 'black' };
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px' };
const cardStyle = (low, pending) => ({ padding: '12px', border: '3px solid black', backgroundColor: low ? '#FFD1D1' : 'white', boxShadow: pending ? '5px 5px 0px #FFD600' : '3px 3px 0px black', position: 'relative' });
const itemTitle = { fontSize: '0.85rem', fontWeight: 900, margin: '5px 0', textTransform: 'uppercase' };
const stokWrapper = { display: 'flex', alignItems: 'baseline', gap: '4px' };
const stokDisplay = { fontSize: '2.2rem', fontWeight: 900, lineHeight:1 };
const originalInfo = { fontSize: '0.55rem', fontWeight: 900, color: 'brown', backgroundColor:'#fff9c4', padding:'1px 3px' };
const actionBtn = (bg) => ({ flex: 1, padding: '8px', border: '2px solid black', backgroundColor: bg, cursor: 'pointer', display:'flex', justifyContent:'center', boxShadow:'2px 2px 0px black' });
const alertSticker = { position: 'absolute', top: '-8px', right: '-8px', backgroundColor: '#FFD600', border: '2px solid black', padding: '2px 6px', fontWeight: 900, fontSize: '0.6rem', transform: 'rotate(10deg)' };
const miniInput = { fontSize: '0.55rem', border: '1px solid black', width: '50px', backgroundColor: '#eee', padding:'1px', fontWeight:900 };
const iconSmall = { background: 'none', border: 'none', cursor: 'pointer' };
const loginWrapper = { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#FFFDF0' };
const loginCard = { border: '4px solid black', padding: '30px', backgroundColor: 'white', boxShadow: '8px 8px 0px black' };
const mainBtnStyle = (bg) => ({ padding: '10px', border: '3px solid black', backgroundColor: bg, fontWeight: 900, cursor: 'pointer', width: '100%', marginTop:'8px', boxShadow:'3px 3px 0px black' });
const modalOverlay = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 };
const modalBox = { backgroundColor: 'white', border: '4px solid black', padding: '20px', width: '85%', maxWidth: '350px' };
const saveBar = { position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 100, width: '90%', maxWidth: '400px', display:'flex', gap:'10px' };
const saveBtn = { flex:1, padding: '15px', backgroundColor: '#FFD600', border: '4px solid black', fontWeight: 900, boxShadow: '5px 5px 0px black', cursor: 'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:'8px' };
const resetBtn = { width:'55px', backgroundColor:'white', border:'4px solid black', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'5px 5px 0px black', cursor:'pointer' };
const formStyle = { border: '3px solid black', padding: '15px', marginBottom: '20px', backgroundColor: 'white', boxShadow:'6px 6px 0px #C3FAFF' };
const inputStyle = { width: '100%', padding: '8px', border: '2px solid black', marginBottom: '5px', boxSizing:'border-box', fontFamily:'monospace', fontWeight:900 };
const miniLabel = { fontSize: '0.55rem', fontWeight: 900 };