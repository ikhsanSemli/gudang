import { useEffect, useState, useRef } from 'react';
import { supabase } from './supabaseClient';
import { 
  Plus, Minus, History, X, PackagePlus, AlertCircle, 
  LogOut, FileText, Save, RotateCcw, MessageCircle, Clock, ArrowUpRight, ArrowDownLeft, Loader2
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
  const [isSaving, setIsSaving] = useState(false); // Fix Poin 4: Loading State
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
  const [logDate, setLogDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => { 
    fetchBarang(); 
    fetchKasir();
    fetchDailyLogs();
    const savedUser = localStorage.getItem('gudang_user');
    if (savedUser) setCurrentUser(JSON.parse(savedUser));
  }, [logDate]);

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

  const fetchDailyLogs = async (targetDate = logDate) => {
    // Mencari rentang waktu 00:00:00 sampai 23:59:59 di hari tersebut
    const startOfDay = `${targetDate}T00:00:00.000Z`;
    const endOfDay = `${targetDate}T23:59:59.999Z`;

    const { data } = await supabase.from('log_aktivitas')
      .select('*, barang(nama, satuan)')
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay)
      .order('created_at', { ascending: false });
      
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

  // Fix Poin 3: Fungsi update stok sekarang lebih fleksibel (bisa via input ketik)
  const updateStokLokal = (item, nilaiBaru) => {
    if (!currentUser) return alert("Pilih namamu dulu!");
    if (nilaiBaru < 0) return;

    setItems(prevItems => {
      const newItems = prevItems.map(i => (i.id === item.id ? { ...i, stok: nilaiBaru } : i));
      const selisihTotal = nilaiBaru - (originalStok.current[item.id] || 0);
      setPendingChanges(prev => ({ ...prev, [item.id]: selisihTotal }));
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
    
    setIsSaving(true); // Fix Poin 4: Mulai Loading
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
    finally { setIsSaving(false); } // Matikan Loading
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
      });
      doc.save(`Laporan_${labelPeriode}.pdf`);
      setShowReportModal(false);
    } catch (err) { alert("Gagal PDF: " + err.message); }
  };

  const sendWA = () => {
    const tglTerpilih = new Date(logDate).toLocaleDateString('id-ID', { 
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' 
    });
    
    let pesan = `*📦 LAPORAN GUDANG SANTUY*\n_Tanggal: ${tglTerpilih}_\n\n`;
    
    // 1. BAGIAN AKTIVITAS
    pesan += `*─── AKTIVITAS ${new Date(logDate).toLocaleDateString('id-ID', {day:'2-digit', month:'short'}).toUpperCase()} ───*\n`;
    if (dailyLogs.length > 0) {
      dailyLogs.forEach(l => { 
        const simbol = l.aksi === 'masuk' ? '📥' : '📤';
        pesan += `${simbol} ${l.barang?.nama}: *${l.aksi === 'masuk' ? '+' : '-'}${l.jumlah}*\n`; 
      });
    } else { 
      pesan += `_Tidak ada aktivitas_\n`; 
    }

    // 2. BAGIAN SISA STOK (TAMBAHAN BARU)
    pesan += `\n*─── SISA STOK GUDANG ───*\n`;
    if (items.length > 0) {
      items.forEach(i => {
        pesan += `• ${i.nama}: *${i.stok}* ${i.satuan}\n`;
      });
    } else {
      pesan += `_Data barang kosong_\n`;
    }

    // 3. BAGIAN STOK KRITIS
    pesan += `\n*─── ⚠️ STOK KRITIS (ORDER!) ───*\n`;
    const kritis = items.filter(i => i.stok <= i.min_stok);
    if (kritis.length > 0) {
      kritis.forEach(i => { pesan += `- ${i.nama}: *Sisa ${i.stok}* ${i.satuan}\n`; });
    } else {
      pesan += `_Semua stok aman! ✅_\n`;
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(pesan)}`, '_blank');
  };

  const changeLogDate = (days) => {
    const d = new Date(logDate);
    d.setDate(d.getDate() + days);
    setLogDate(d.toISOString().split('T')[0]);
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
          <h1 style={{textAlign:'center', fontWeight:900, letterSpacing:'-1px'}}>GUDANG SANTUY</h1>
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
          {/* TOMBOL WA KEMBALI HADIR */}
          <button onClick={sendWA} title="Kirim WA" style={iconBtnStyle('#25D366')}><MessageCircle color="white"/></button>
          <button onClick={() => setShowAddForm(!showAddForm)} style={iconBtnStyle('#C3FAFF')}><PackagePlus/></button>
          <button onClick={() => setShowReportModal(true)} style={iconBtnStyle('#99E2B4')}><FileText/></button>
          <button onClick={handleLogout} style={iconBtnStyle('#FF9292')}><LogOut/></button>
        </div>
      </nav>

      {/* DASHBOARD RINGKAS */}
      <div style={quickLookWrapper}>
        <div style={statCard('#C3FAFF')}>
            <span style={statLabel}>TOTAL BARANG</span>
            <span style={statValue}>{items.length}</span>
        </div>
        <div style={statCard(itemsLimit.length > 0 ? '#FF9292' : '#99E2B4')}>
          <span style={statLabel}>⚠️ LIMIT ORDER</span>
          <span style={statValue}>{itemsLimit.length}</span>
        </div>
      </div>

      {/* GRID BARANG */}
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
                            const {data} = await supabase.from('log_aktivitas').select('*').eq('barang_id', item.id).order('created_at', { ascending: false }).limit(10);
                            setHistory(data || []);
                        }} style={iconSmall}><History size={14}/></button>
                    </div>
                    <h2 style={itemTitle}>{item.nama}</h2>
                    
                    {/* Fix Poin 3: Input stok yang bisa diketik langsung */}
                    <div style={stokWrapper}>
                        <input 
                            type="number" 
                            value={item.stok} 
                            onChange={(e) => updateStokLokal(item, parseInt(e.target.value) || 0)}
                            style={stokInput}
                        />
                        <span style={{fontSize:'0.6rem', fontWeight:900}}>{item.satuan}</span>
                    </div>

                    <div style={{display:'flex', gap:'5px', marginTop:'8px'}}>
                        <button onClick={() => updateStokLokal(item, item.stok - 1)} style={actionBtn('#FF9292')}><Minus size={14}/></button>
                        <button onClick={() => updateStokLokal(item, item.stok + 1)} style={actionBtn('#99E2B4')}><Plus size={14}/></button>
                    </div>
                    {item.stok <= item.min_stok && <div style={alertSticker}>ORDER!</div>}
                </div>
                ))}
            </div>
            </div>
        ))}
      </div>

      {/* --- SECTION LOG DENGAN NAVIGASI HARI --- */}
      <div style={logSection}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
          <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
            <Clock size={20}/>
            <h3 style={{margin:0, fontWeight:900, fontSize:'0.9rem'}}>RIWAYAT AKTIVITAS</h3>
          </div>
          
          {/* NAVIGASI TANGGAL */}
          <div style={{display:'flex', border:'3px solid black', backgroundColor:'white', boxShadow:'3px 3px 0px black'}}>
            <button onClick={() => changeLogDate(-1)} style={navDayBtn}><Minus size={14}/></button>
            <div style={dateDisplay}>
              {new Date(logDate).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}
            </div>
            <button 
              onClick={() => changeLogDate(1)} 
              style={{...navDayBtn, opacity: logDate === new Date().toISOString().split('T')[0] ? 0.3 : 1}}
              disabled={logDate === new Date().toISOString().split('T')[0]}
            ><Plus size={14}/></button>
          </div>
        </div>

        <div style={logScrollContainer}>
            {dailyLogs.length > 0 ? dailyLogs.map(log => (
                <div key={log.id} style={logCard}>
                    <div style={logIcon(log.aksi)}>{log.aksi === 'masuk' ? <ArrowUpRight size={14}/> : <ArrowDownLeft size={14}/>}</div>
                    <div style={{flex:1}}>
                        <div style={logText}><b>{log.barang?.nama}</b></div>
                        <div style={logMeta}>{log.kasir_nama?.toUpperCase()} • {new Date(log.created_at).toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'})}</div>
                    </div>
                    <div style={logQty(log.aksi)}>{log.aksi === 'masuk' ? '+' : '-'}{log.jumlah}</div>
                </div>
            )) : (
              <div style={{textAlign:'center', padding:'30px', border:'2px dashed black', fontSize:'0.7rem'}}>
                Tidak ada aktivitas pada tanggal ini.
              </div>
            )}
        </div>
      </div>

      {/* FLOATING BAR (Fix Poin 4: Disabled state) */}
      {Object.values(pendingChanges).some(v => v !== 0) && (
        <div style={saveBar}>
          <button onClick={handleReset} style={resetBtn} disabled={isSaving}><RotateCcw/></button>
          <button onClick={handleSaveAll} style={{...saveBtn, opacity: isSaving ? 0.7 : 1}} disabled={isSaving}>
            {isSaving ? <Loader2 className="animate-spin" /> : <Save size={20}/>} 
            {isSaving ? "MENYIMPAN..." : "SIMPAN PERUBAHAN"}
          </button>
        </div>
      )}

      {/* Fix Poin 2: Modal History dengan Nama PIC */}
      <AnimatePresence>
        {selectedItem && (
          <div style={modalOverlay} onClick={() => setSelectedItem(null)}>
            <motion.div initial={{y:50}} animate={{y:0}} style={modalBox} onClick={e => e.stopPropagation()}>
               <div style={{display:'flex', justifyContent:'space-between', borderBottom:'3px solid black', paddingBottom:'5px'}}>
                  <h3 style={{margin:0}}>{selectedItem.nama.toUpperCase()}</h3>
                  <X onClick={() => setSelectedItem(null)} style={{cursor:'pointer'}}/>
               </div>
               <div style={{maxHeight:'250px', overflowY:'auto', marginTop:'10px'}}>
                  {history.map(h => (
                    <div key={h.id} style={historyItemRow}>
                      <div>
                        <div style={{fontWeight:900, fontSize:'0.8rem'}}>{h.aksi.toUpperCase()} {h.jumlah} {selectedItem.satuan}</div>
                        <div style={{fontSize:'0.6rem', color:'#666'}}>Oleh: <b>{h.kasir_nama || 'System'}</b></div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontSize:'0.6rem'}}>{new Date(h.created_at).toLocaleDateString('id-ID')}</div>
                        <div style={{fontSize:'0.5rem', fontWeight:900}}>Sisa: {h.stok_sesudah}</div>
                      </div>
                    </div>
                  ))}
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      
      {/* MODAL PDF Preset */}
      <AnimatePresence>
        {showReportModal && (
          <div style={modalOverlay} onClick={() => setShowReportModal(false)}>
            <motion.div initial={{scale:0.9}} animate={{scale:1}} style={modalBox} onClick={e => e.stopPropagation()}>
              <h2 style={{fontWeight:900, marginBottom:'15px', borderBottom:'4px solid black'}}>LAPORAN</h2>
              <button onClick={() => generatePDF('preset', 0)} style={mainBtnStyle('#C3FAFF')}>HARI INI</button>
              <button onClick={() => generatePDF('preset', 6)} style={mainBtnStyle('#99E2B4')}>7 HARI TERAKHIR</button>
              <button onClick={() => setShowReportModal(false)} style={mainBtnStyle('#eee')}>TUTUP</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- STYLES ---
const layoutStyle = { padding: '20px', maxWidth: '600px', margin: 'auto', backgroundColor: '#FFFDF0', minHeight: '100vh', fontFamily: 'monospace' };
const navStyle = { display: 'flex', justifyContent: 'space-between', marginBottom: '30px' };
const logoStyle = { fontSize: '1.8rem', fontWeight: 900, lineHeight: 0.8 };
const badgeStyle = { backgroundColor: 'black', color: 'white', display: 'inline-block', padding: '2px 8px', fontSize: '0.6rem', fontWeight: 900, marginTop:'5px' };
const iconBtnStyle = (bg) => ({ width: '45px', height: '45px', border: '3px solid black', backgroundColor: bg, boxShadow: '3px 3px 0px black', cursor: 'pointer', display:'flex', alignItems:'center', justifyContent:'center' });
const quickLookWrapper = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '25px' };
const statCard = (bg) => ({ padding: '12px', border: '4px solid black', backgroundColor: bg, boxShadow: '5px 5px 0px black' });
const statLabel = { fontSize: '0.6rem', fontWeight: 900 };
const statValue = { fontSize: '2.2rem', fontWeight: 900, lineHeight:1, display:'block' };
const logSection = { marginTop: '20px', paddingBottom: '120px' };
const logScrollContainer = { display:'grid', gap:'8px', maxHeight:'400px', overflowY:'auto', padding:'5px' };
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
const itemTitle = { fontSize: '0.85rem', fontWeight: 900, margin: '5px 0', textTransform: 'uppercase', height:'2.2em', overflow:'hidden' };
const stokWrapper = { display: 'flex', alignItems: 'center', gap: '4px' };
const stokInput = { fontSize: '1.8rem', fontWeight: 900, width: '70px', border: 'none', background: 'transparent', outline: 'none', borderBottom: '2px dashed black' };
const actionBtn = (bg) => ({ flex: 1, padding: '6px', border: '2px solid black', backgroundColor: bg, cursor: 'pointer', display:'flex', justifyContent:'center', boxShadow:'2px 2px 0px black' });
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
const historyItemRow = { display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #ddd', alignItems:'center' };
const formStyle = { border: '3px solid black', padding: '15px', marginBottom: '20px', backgroundColor: 'white', boxShadow:'6px 6px 0px #C3FAFF' };
const inputStyle = { width: '100%', padding: '8px', border: '2px solid black', marginBottom: '5px', boxSizing:'border-box', fontFamily:'monospace', fontWeight:900 };
const miniLabel = { fontSize: '0.55rem', fontWeight: 900 };
const originalInfo = { fontSize: '0.5rem', fontWeight: 900, color: 'brown' };
const navDayBtn = { padding: '5px 10px', border: 'none', backgroundColor: '#FFD600', cursor: 'pointer', fontWeight: 900, borderRight: '2px solid black', borderLeft: '2px solid black' };
const dateDisplay = { padding: '5px 10px', fontSize: '0.7rem', fontWeight: 900, minWidth: '60px', textAlign: 'center', alignSelf: 'center' };