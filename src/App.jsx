import { useEffect, useState, useRef } from 'react';
import { supabase } from './supabaseClient';
import { 
  Plus, Minus, History, X, PackagePlus, AlertCircle, 
  LogOut, FileText, Save, RotateCcw, MessageCircle 
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// --- FIX IMPORT STRATEGY ---

import { jsPDF } from 'jspdf';
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

  // --- FINAL FIX FOR PDF GENERATOR ---
  const generatePDF = async (mode, days = 0) => {
    try {
      const doc = new jsPDF();
      const printDate = new Date().toLocaleString('id-ID');
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

      doc.setFontSize(18); doc.setTextColor(40);
      doc.text('LAPORAN MUTASI & STOK GUDANG', 14, 20);
      doc.setFontSize(10); doc.setTextColor(100);
      doc.text(`Periode: ${labelPeriode} | Dicetak: ${printDate}`, 14, 27);

      const mutasiBody = items.map((item, idx) => {
        const itemLogs = logs?.filter(l => l.barang_id === item.id) || [];
        const masuk = itemLogs.filter(l => l.aksi === 'masuk').reduce((sum, l) => sum + l.jumlah, 0);
        const keluar = itemLogs.filter(l => l.aksi === 'keluar').reduce((sum, l) => sum + l.jumlah, 0);
        return [
          idx + 1,
          item.nama.toUpperCase(),
          masuk > 0 ? `+${masuk}` : '0',
          keluar > 0 ? `-${keluar}` : '0',
          item.stok,
          item.stok <= item.min_stok ? 'RE-STOCK' : 'AMAN'
        ];
      });

      // 2. GUNAKAN FUNGSI autoTable SECARA LANGSUNG (Bukan doc.autoTable)
      // Ini lebih aman karena kita mempassing 'doc' sebagai argumen pertama
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

      const finalY = doc.lastAutoTable.finalY + 15;
      doc.setFontSize(12); doc.setTextColor(0);
      doc.text('RINCIAN AKTIVITAS HARIAN', 14, finalY);

      // Panggil autoTable lagi untuk tabel kedua
      autoTable(doc, {
        startY: finalY + 5,
        head: [['Waktu', 'Barang', 'Aksi', 'Qty']],
        body: logs?.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).map(l => [
          new Date(l.created_at).toLocaleString('id-ID', { hour:'2-digit', minute:'2-digit' }),
          l.barang?.nama || '-', l.aksi.toUpperCase(), l.jumlah
        ]) || [],
        theme: 'striped',
        headStyles: { fillColor: [100, 100, 100] }
      });

      doc.save(`Mutasi_${labelPeriode.replace(/ /g, '_')}.pdf`);
      setShowReportModal(false);
    } catch (err) {
      console.error("Full Error Info:", err);
      alert("Gagal PDF: Silakan refresh halaman atau cek koneksi.");
    }
  };

  const sendWA = () => {
    const hariIni = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
    let pesan = `*📦 LAPORAN GUDANG SANTUY*\n_Tanggal: ${hariIni}_\n\n`;
    pesan += `*─── AKTIVITAS HARI INI ───*\n`;
    dailyLogs.forEach(l => { pesan += `${l.aksi === 'masuk' ? '🟢' : '🔴'} ${l.barang?.nama}: ${l.jumlah}\n`; });
    pesan += `\n*─── SISA STOK ───*\n`;
    items.forEach(i => { pesan += `- ${i.nama}: *${i.stok}*\n`; });
    const kritis = items.filter(i => i.stok <= i.min_stok);
    if (kritis.length > 0) {
      pesan += `\n*─── ⚠️ DAFTAR BELANJA ───*\n`;
      kritis.forEach(i => { pesan += `- ${i.nama} (Sisa ${i.stok})\n`; });
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(pesan)}`, '_blank');
  };

  // --- UI RENDER (Login & Dashboard) ---
  if (!currentUser) {
    return (
      <div style={loginWrapper}>
        <div style={loginCard}>
          <h1 style={{textAlign:'center', fontWeight:900, fontSize:'2rem', margin:0}}>GUDANG</h1>
          <h1 style={{textAlign:'center', fontWeight:900, fontSize:'2rem', marginBottom:'20px'}}>SANTUY</h1>
          <div style={{display:'grid', gap:'10px'}}>
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
        <div style={{display:'flex', gap:'10px'}}>
          <button onClick={sendWA} style={iconBtnStyle('#25D366')} title="Kirim WA"><MessageCircle/></button>
          <button onClick={() => setShowReportModal(true)} style={iconBtnStyle('#99E2B4')} title="Cetak PDF"><FileText/></button>
          <button onClick={handleLogout} style={iconBtnStyle('#FF9292')} title="Logout"><LogOut/></button>
        </div>
      </nav>

      {/* MODAL PDF */}
      <AnimatePresence>
        {showReportModal && (
          <div style={modalOverlay}>
            <motion.div initial={{scale:0.9}} animate={{scale:1}} exit={{scale:0.9}} style={modalBox}>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:'20px'}}>
                <h2 style={{fontWeight:900, margin:0}}>LAPORAN MUTASI</h2>
                <button onClick={() => setShowReportModal(false)} style={{background:'none', border:'none'}}><X/></button>
              </div>
              <div style={{display:'grid', gap:'10px'}}>
                <button onClick={() => generatePDF('preset', 0)} style={mainBtnStyle('#C3FAFF')}>HARI INI</button>
                <button onClick={() => generatePDF('preset', 6)} style={mainBtnStyle('#99E2B4')}>7 HARI TERAKHIR</button>
                <div style={{border:'3px solid black', padding:'15px', backgroundColor:'#f5f5f5'}}>
                  <p style={{fontSize:'0.7rem', fontWeight:900}}>RENTANG TANGGAL:</p>
                  <input type="date" value={customDate.start} onChange={e => setCustomDate({...customDate, start: e.target.value})} style={inputStyle} />
                  <input type="date" value={customDate.end} onChange={e => setCustomDate({...customDate, end: e.target.value})} style={inputStyle} />
                  <button onClick={() => generatePDF('custom')} style={{...mainBtnStyle('#000'), color:'#fff', width:'100%', marginTop:'10px'}}>CETAK</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DASHBOARD STATS */}
      <div style={quickLookWrapper}>
        <div style={statCard('#C3FAFF')}><span style={statLabel}>BARANG</span><span style={statValue}>{totalBarang}</span></div>
        <div style={statCard(jmlKritis > 0 ? '#FF9292' : '#99E2B4')}><span style={statLabel}>LIMIT</span><span style={statValue}>{jmlKritis}</span></div>
        <div style={{...statCard('#FFD600'), gridColumn:'span 2', height:'140px'}}>
          <span style={statLabel}>AKTIVITAS HARI INI</span>
          <div style={scrollLogWrapper}>
            {dailyLogs.length > 0 ? dailyLogs.map(l => (
              <div key={l.id} style={logItem}>
                <span style={{backgroundColor: l.aksi === 'masuk' ? '#99E2B4' : '#FF9292', padding:'2px 5px', border:'2px solid black', fontSize:'0.5rem', fontWeight:900}}>{l.aksi.toUpperCase()}</span>
                <span style={{flex:1, marginLeft:'10px', fontWeight:'bold'}}>{l.barang?.nama} ({l.jumlah})</span>
              </div>
            )) : <p style={{fontSize:'0.7rem', textAlign:'center', marginTop:'15px', opacity:0.5}}>Belum ada aktivitas.</p>}
          </div>
        </div>
      </div>

      {/* SAVE BUTTON DRAFT */}
      {Object.values(pendingChanges).some(v => v !== 0) && (
        <motion.div initial={{y:20}} animate={{y:0}} style={saveContainer}>
          <button onClick={handleSaveAll} style={saveBtn}>SIMPAN KE DATABASE</button>
        </motion.div>
      )}

      {/* MAIN LIST */}
      <div style={gridStyle}>
        {items.map(item => (
          <div key={item.id} style={cardStyle(item.stok <= item.min_stok, pendingChanges[item.id])}>
            <h2 style={itemTitle}>{item.nama}</h2>
            <div style={stokDisplay}>{item.stok}</div>
            <div style={{display:'flex', gap:'10px'}}>
              <button onClick={() => updateStokLokal(item, -1)} style={actionBtn('#FF9292')}><Minus/></button>
              <button onClick={() => updateStokLokal(item, 1)} style={actionBtn('#99E2B4')}><Plus/></button>
            </div>
            {item.stok <= item.min_stok && <div style={alertSticker}>ORDER!</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- STYLES (BRUTALISM) ---
const layoutStyle = { padding: '20px', maxWidth: '800px', margin: 'auto', backgroundColor: '#FFFDF0', minHeight: '100vh', fontFamily: 'sans-serif' };
const navStyle = { display: 'flex', justifyContent: 'space-between', marginBottom: '30px' };
const logoStyle = { fontSize: '2rem', fontWeight: 900, lineHeight: 0.8, margin: 0 };
const badgeStyle = { backgroundColor: 'black', color: 'white', display: 'inline-block', padding: '2px 8px', fontSize: '0.6rem', fontWeight: 900, marginTop: '5px' };
const iconBtnStyle = (bg) => ({ width: '50px', height: '50px', border: '3px solid black', backgroundColor: bg, boxShadow: '4px 4px 0px black', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' });
const loginWrapper = { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#FFFDF0' };
const loginCard = { border: '4px solid black', padding: '40px', backgroundColor: 'white', boxShadow: '12px 12px 0px black' };
const quickLookWrapper = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '30px' };
const statCard = (bg) => ({ padding: '15px', border: '4px solid black', backgroundColor: bg, boxShadow: '5px 5px 0px black', position: 'relative' });
const statLabel = { fontSize: '0.6rem', fontWeight: 900, display: 'block' };
const statValue = { fontSize: '2.5rem', fontWeight: 900 };
const scrollLogWrapper = { marginTop: '10px', height: '80px', overflowY: 'auto' };
const logItem = { display: 'flex', alignItems: 'center', fontSize: '0.6rem', marginBottom: '5px', borderBottom: '1px solid black', paddingBottom: '3px' };
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '20px' };
const cardStyle = (low, pending) => ({ padding: '20px', border: '4px solid black', backgroundColor: low ? '#FFD1D1' : 'white', boxShadow: pending ? '8px 8px 0px #FFD600' : '6px 6px 0px black', position: 'relative' });
const itemTitle = { fontSize: '1rem', fontWeight: 900, margin: '0 0 10px 0', textTransform: 'uppercase' };
const stokDisplay = { fontSize: '3rem', fontWeight: 900, marginBottom: '15px' };
const actionBtn = (bg) => ({ flex: 1, padding: '10px', border: '3px solid black', backgroundColor: bg, cursor: 'pointer', display: 'flex', justifyContent: 'center' });
const alertSticker = { position: 'absolute', top: '-10px', right: '-10px', backgroundColor: '#FFD600', border: '3px solid black', padding: '2px 8px', fontWeight: 900, fontSize: '0.7rem', transform: 'rotate(5deg)' };
const modalOverlay = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 };
const modalBox = { backgroundColor: 'white', border: '5px solid black', padding: '30px', boxShadow: '15px 15px 0px black', width: '90%', maxWidth: '400px' };
const mainBtnStyle = (bg) => ({ padding: '12px', border: '3px solid black', backgroundColor: bg, fontWeight: 900, cursor: 'pointer', width: '100%' });
const inputStyle = { width: '100%', padding: '10px', border: '2px solid black', marginBottom: '5px', fontWeight: 'bold' };
const saveContainer = { position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 100, width: '90%', maxWidth: '400px' };
const saveBtn = { width: '100%', padding: '15px', backgroundColor: '#FFD600', border: '4px solid black', fontWeight: 900, boxShadow: '6px 6px 0px black', cursor: 'pointer' };