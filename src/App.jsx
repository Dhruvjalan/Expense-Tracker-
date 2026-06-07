import { useState, useEffect, useRef, useCallback } from "react";
import * as XLSX from "xlsx";

// ── Constants ─────────────────────────────────────────────────
const DEFAULT_CATEGORIES = [
  { name: "Food & Dining", icon: "🍽️", color: "#FF6B6B" },
  { name: "Transport",     icon: "🚗", color: "#4ECDC4" },
  { name: "Shopping",      icon: "🛍️", color: "#FFE66D" },
  { name: "Health",        icon: "💊", color: "#A8E6CF" },
  { name: "Entertainment", icon: "🎬", color: "#C3A6FF" },
  { name: "Utilities",     icon: "💡", color: "#FFB347" },
  { name: "Education",     icon: "📚", color: "#87CEEB" },
  { name: "Househelp",     icon: "🧹", color: "#F9A8D4" },
  { name: "Laundry",       icon: "👕", color: "#6EE7B7" },
  { name: "Other",         icon: "📌", color: "#CBD5E1" },
];
const DEFAULT_MEMBERS = ["Self", "Spouse", "Parent", "Child", "Other"];
const CAT_COLORS = ["#FF6B6B","#FF9F43","#FFE66D","#A8E6CF","#6EE7B7","#4ECDC4","#87CEEB","#6366F1","#C3A6FF","#F9A8D4","#FB923C","#CBD5E1"];
const CAT_ICONS  = ["🍽️","🚗","🛍️","💊","🎬","💡","📚","🧹","👕","📌","🏠","✈️","🎁","💰","🐾","🏋️","☕","🍺","💻","🎮"];
const SOURCES    = ["Cash","UPI","Credit Card","Debit Card","Net Banking","Wallet"];

const fmt     = (n) => new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(n);
const fmtDate = (d) => new Date(d).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});
const today   = () => new Date().toISOString().split("T")[0];
const EMPTY_FORM = { amount:"", category:"", source:"", date:today(), note:"", spentBy:"" };

// ── Shared storage helpers ─────────────────────────────────────
const sget = async (key) => { try { const r = await window.storage.get(key, true); return r ? JSON.parse(r.value) : null; } catch { return null; } };
const sset = async (key, val) => { try { await window.storage.set(key, JSON.stringify(val), true); } catch {} };
const genId = () => Math.random().toString(36).slice(2,6).toUpperCase() + Math.random().toString(36).slice(2,6).toUpperCase();

// ── Role badge component ──────────────────────────────────────
function RoleBadge({ isAdmin }) {
  return (
    <div style={{
      display:"inline-flex", alignItems:"center", gap:4,
      padding:"3px 9px", borderRadius:20, fontSize:11, fontWeight:700,
      background: isAdmin ? "rgba(251,146,60,0.2)" : "rgba(148,163,184,0.15)",
      border: `1px solid ${isAdmin ? "rgba(251,146,60,0.4)" : "rgba(148,163,184,0.25)"}`,
      color: isAdmin ? "#FB923C" : "#94A3B8",
    }}>
      {isAdmin ? "👑 Admin" : "👁 Viewer"}
    </div>
  );
}

// ── Locked action notice ──────────────────────────────────────
function LockedNotice({ action }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:12,padding:"10px 14px",marginBottom:16}}>
      <span style={{fontSize:16}}>🔒</span>
      <span style={{fontSize:13,color:"rgba(255,255,255,0.5)"}}>Only the Admin can {action}.</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
export default function App() {
  // Identity & room
  const [screen,     setScreen]     = useState("splash");
  const [roomId,     setRoomId]     = useState("");
  const [roomInput,  setRoomInput]  = useState("");
  const [myName,     setMyName]     = useState("");
  const [myRole,     setMyRole]     = useState("member"); // "admin" | "member"
  const [nameInput,  setNameInput]  = useState("");
  const [joinError,  setJoinError]  = useState("");
  const [onlineUsers,setOnlineUsers]= useState([]); // [{name, role}]

  // Shared data
  const [expenses,   setExpenses]   = useState([]);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [members,    setMembers]    = useState(DEFAULT_MEMBERS);
  const [roomMeta,   setRoomMeta]   = useState(null); // {adminName, adminPin, createdAt}

  // UI
  const [view,         setView]         = useState("list");
  const [subView,      setSubView]      = useState(null);
  const [form,         setForm]         = useState(EMPTY_FORM);
  const [filterCat,    setFilterCat]    = useState("All");
  const [filterMember, setFilterMember] = useState("All");
  const [toast,        setToast]        = useState(null);
  const [newCat,       setNewCat]       = useState({ name:"", icon:"📌", color:CAT_COLORS[0] });
  const [newMember,    setNewMember]    = useState("");
  const [syncing,      setSyncing]      = useState(false);
  // Admin PIN verification
  const [pinPrompt,    setPinPrompt]    = useState(false); // show PIN entry to claim admin
  const [pinInput,     setPinInput]     = useState("");
  const [pinError,     setPinError]     = useState("");

  const pollRef = useRef(null);
  const isAdmin = myRole === "admin";

  // ── Helpers ─────────────────────────────────────────────────
  const showToast = (msg, color="#6366F1") => { setToast({msg,color}); setTimeout(()=>setToast(null),2400); };
  const rKey  = (r) => `room:${r}:data`;
  const oKey  = (r) => `room:${r}:online`;
  const mKey  = (r) => `room:${r}:meta`;

  // ── Sync pull ────────────────────────────────────────────────
  const pullData = useCallback(async (rid) => {
    const data = await sget(rKey(rid));
    if (data) {
      if (data.expenses)   setExpenses(data.expenses);
      if (data.categories) setCategories(data.categories);
      if (data.members)    setMembers(data.members);
    }
    const online = await sget(oKey(rid));
    if (online) {
      const now = Date.now();
      const active = Object.entries(online)
        .filter(([,v]) => now - v.ts < 20000)
        .map(([name,v]) => ({ name, role: v.role }));
      setOnlineUsers(active);
    }
  }, []);

  // ── Sync push ────────────────────────────────────────────────
  const pushData = useCallback(async (rid, exps, cats, mems) => {
    await sset(rKey(rid), { expenses:exps, categories:cats, members:mems, ts:Date.now() });
  }, []);

  // ── Heartbeat ────────────────────────────────────────────────
  const sendHeartbeat = useCallback(async (rid, name, role) => {
    const online = (await sget(oKey(rid))) || {};
    online[name] = { ts: Date.now(), role };
    await sset(oKey(rid), online);
  }, []);

  // ── Start polling ────────────────────────────────────────────
  const startPolling = useCallback((rid, name, role) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pullData(rid);
    sendHeartbeat(rid, name, role);
    pollRef.current = setInterval(async () => {
      setSyncing(true);
      await pullData(rid);
      await sendHeartbeat(rid, name, role);
      setSyncing(false);
    }, 4000);
  }, [pullData, sendHeartbeat]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ── Create room (creator = Admin) ────────────────────────────
  const createRoom = async () => {
    const name = nameInput.trim();
    if (!name) { setJoinError("Enter your name"); return; }
    const rid  = genId();
    const pin  = Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit PIN
    const meta = { adminName: name, adminPin: pin, createdAt: Date.now() };
    const data = { expenses:[], categories:DEFAULT_CATEGORIES, members:DEFAULT_MEMBERS, ts:Date.now() };
    await sset(rKey(rid), data);
    await sset(mKey(rid), meta);
    setRoomId(rid); setMyName(name); setMyRole("admin"); setRoomMeta(meta);
    setExpenses([]); setCategories(DEFAULT_CATEGORIES); setMembers(DEFAULT_MEMBERS);
    setScreen("app");
    startPolling(rid, name, "admin");
    // Show PIN to admin
    setTimeout(() => showToast(`🔑 Admin PIN: ${pin} — save this!`, "#FB923C"), 600);
  };

  // ── Join room (joiner = Member by default) ────────────────────
  const joinRoom = async () => {
    const name = nameInput.trim();
    const rid  = roomInput.trim().toUpperCase();
    if (!name) { setJoinError("Enter your name"); return; }
    if (rid.length < 6) { setJoinError("Enter a valid Room ID"); return; }
    const existing = await sget(rKey(rid));
    if (!existing) { setJoinError("Room not found. Check the Room ID."); return; }
    const meta = await sget(mKey(rid));
    setRoomId(rid); setMyName(name); setMyRole("member"); setRoomMeta(meta);
    setExpenses(existing.expenses || []);
    setCategories(existing.categories || DEFAULT_CATEGORIES);
    setMembers(existing.members || DEFAULT_MEMBERS);
    setScreen("app");
    startPolling(rid, name, "member");
  };

  // ── Claim admin via PIN ───────────────────────────────────────
  const claimAdmin = async () => {
    if (!roomMeta) return;
    if (pinInput === roomMeta.adminPin) {
      setMyRole("admin");
      setPinPrompt(false); setPinInput(""); setPinError("");
      // Update heartbeat with new role
      const online = (await sget(oKey(roomId))) || {};
      online[myName] = { ts: Date.now(), role: "admin" };
      await sset(oKey(roomId), online);
      showToast("Admin access granted 👑", "#FB923C");
    } else {
      setPinError("Incorrect PIN");
    }
  };

  // ── Data mutations (Admin only enforced in UI) ────────────────
  const addExpense = async () => {
    if (!isAdmin) { showToast("Only Admin can add expenses", "#EF4444"); return; }
    if (!form.amount||!form.category||!form.source||!form.date||!form.spentBy) { showToast("Please fill all fields","#EF4444"); return; }
    const updated = [{ ...form, id:Date.now(), amount:parseFloat(form.amount), addedBy:myName }, ...expenses];
    setExpenses(updated); setForm(EMPTY_FORM); setView("list");
    await pushData(roomId, updated, categories, members);
    showToast("Added ✓");
  };

  const deleteExpense = async (id) => {
    if (!isAdmin) { showToast("Only Admin can delete","#EF4444"); return; }
    const updated = expenses.filter(e=>e.id!==id);
    setExpenses(updated);
    await pushData(roomId, updated, categories, members);
    showToast("Deleted","#64748B");
  };

  const addCategory = async () => {
    if (!newCat.name.trim()) { showToast("Enter a name","#EF4444"); return; }
    if (categories.find(c=>c.name.toLowerCase()===newCat.name.trim().toLowerCase())) { showToast("Already exists","#EF4444"); return; }
    const updated = [...categories, {...newCat, name:newCat.name.trim()}];
    setCategories(updated); setNewCat({name:"",icon:"📌",color:CAT_COLORS[0]});
    await pushData(roomId, expenses, updated, members);
    showToast("Category added ✓"); setSubView("manage-cats");
  };

  const deleteCategory = async (name) => {
    if (DEFAULT_CATEGORIES.find(c=>c.name===name)) { showToast("Cannot delete default","#EF4444"); return; }
    const updated = categories.filter(c=>c.name!==name);
    setCategories(updated);
    await pushData(roomId, expenses, updated, members);
    showToast("Removed");
  };

  const addMember = async () => {
    if (!newMember.trim()) { showToast("Enter a name","#EF4444"); return; }
    if (members.find(m=>m.toLowerCase()===newMember.trim().toLowerCase())) { showToast("Already exists","#EF4444"); return; }
    const updated = [...members, newMember.trim()];
    setMembers(updated); setNewMember("");
    await pushData(roomId, expenses, categories, updated);
    showToast("Member added ✓"); setSubView("manage-members");
  };

  const deleteMember = async (name) => {
    if (DEFAULT_MEMBERS.includes(name)) { showToast("Cannot delete default","#EF4444"); return; }
    const updated = members.filter(m=>m!==name);
    setMembers(updated);
    await pushData(roomId, expenses, categories, updated);
    showToast("Removed");
  };

  const exportToExcel = () => {
    if (!isAdmin) { showToast("Only Admin can export","#EF4444"); return; }
    if (!expenses.length) { showToast("No expenses to export","#EF4444"); return; }
    const wb = XLSX.utils.book_new();
    const txRows = [["#","Date","Category","Spent By","Added By","Payment Source","Amount (₹)","Note"]];
    [...expenses].sort((a,b)=>new Date(a.date)-new Date(b.date)).forEach((e,i)=>{
      txRows.push([i+1,fmtDate(e.date),e.category,e.spentBy,e.addedBy||"",e.source,e.amount,e.note||""]);
    });
    txRows.push(["","","","","","TOTAL",{f:`SUM(G2:G${expenses.length+1})`},""]);
    const s1=XLSX.utils.aoa_to_sheet(txRows); s1["!cols"]=[{wch:4},{wch:14},{wch:16},{wch:12},{wch:12},{wch:16},{wch:14},{wch:24}];
    XLSX.utils.book_append_sheet(wb,s1,"Transactions");
    const catRows=[["Category","Transactions","Total (₹)"]];
    categories.forEach(c=>{ const ex=expenses.filter(e=>e.category===c.name); if(ex.length) catRows.push([c.name,ex.length,ex.reduce((s,e)=>s+e.amount,0)]); });
    catRows.push(["TOTAL",expenses.length,expenses.reduce((s,e)=>s+e.amount,0)]);
    const s2=XLSX.utils.aoa_to_sheet(catRows); s2["!cols"]=[{wch:20},{wch:16},{wch:16}];
    XLSX.utils.book_append_sheet(wb,s2,"By Category");
    const memRows=[["Member","Transactions","Total (₹)"]];
    members.forEach(m=>{ const ex=expenses.filter(e=>e.spentBy===m); if(ex.length) memRows.push([m,ex.length,ex.reduce((s,e)=>s+e.amount,0)]); });
    memRows.push(["TOTAL",expenses.length,expenses.reduce((s,e)=>s+e.amount,0)]);
    const s3=XLSX.utils.aoa_to_sheet(memRows); s3["!cols"]=[{wch:16},{wch:16},{wch:16}];
    XLSX.utils.book_append_sheet(wb,s3,"By Member");
    XLSX.writeFile(wb,`Expenses_${roomId}_${new Date().toISOString().slice(0,10)}.xlsx`);
    showToast("Exported ✓","#10B981");
  };

  // ── Derived ──────────────────────────────────────────────────
  const getCat     = (name) => categories.find(c=>c.name===name)||{color:"#CBD5E1",icon:"📌"};
  const filtered   = expenses.filter(e=>filterCat==="All"||e.category===filterCat).filter(e=>filterMember==="All"||e.spentBy===filterMember);
  const monthKey   = new Date().toISOString().slice(0,7);
  const monthTotal = expenses.filter(e=>e.date.startsWith(monthKey)).reduce((s,e)=>s+e.amount,0);
  const allTotal   = expenses.reduce((s,e)=>s+e.amount,0);
  const catTotals  = categories.map(c=>({...c,total:expenses.filter(e=>e.category===c.name).reduce((s,e)=>s+e.amount,0)})).filter(c=>c.total>0).sort((a,b)=>b.total-a.total);
  const memTotals  = members.map(m=>({name:m,total:expenses.filter(e=>e.spentBy===m).reduce((s,e)=>s+e.amount,0)})).filter(m=>m.total>0).sort((a,b)=>b.total-a.total);
  const maxCat = catTotals[0]?.total||1;
  const maxMem = memTotals[0]?.total||1;

  // ══════════════════════════════════════════════════════════════
  // SPLASH
  // ══════════════════════════════════════════════════════════════
  if (screen==="splash") return (
    <Shell>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",padding:"0 32px",textAlign:"center"}}>
        <div style={{fontSize:60,marginBottom:14}}>💸</div>
        <div style={{fontSize:28,fontWeight:800,letterSpacing:-0.5,marginBottom:6}}>Expense Tracker</div>
        <div style={{fontSize:13,opacity:0.4,marginBottom:10,lineHeight:1.7}}>Real-time shared tracking<br/>with Admin access control</div>
        {/* Role legend */}
        <div style={{display:"flex",gap:12,marginBottom:40,justifyContent:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,background:"rgba(251,146,60,0.1)",border:"1px solid rgba(251,146,60,0.25)",borderRadius:20,padding:"6px 14px"}}>
            <span>👑</span><span style={{fontSize:12,color:"#FB923C",fontWeight:600}}>Admin — full control</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6,background:"rgba(148,163,184,0.08)",border:"1px solid rgba(148,163,184,0.2)",borderRadius:20,padding:"6px 14px"}}>
            <span>👁</span><span style={{fontSize:12,color:"#94A3B8",fontWeight:600}}>Viewer — view only</span>
          </div>
        </div>
        <button onClick={()=>setScreen("join")} style={{width:"100%",padding:"17px",borderRadius:16,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#6366F1,#8B5CF6)",color:"#fff",fontSize:17,fontWeight:700,boxShadow:"0 8px 32px rgba(99,102,241,0.4)"}}>
          Get Started
        </button>
      </div>
    </Shell>
  );

  // ══════════════════════════════════════════════════════════════
  // JOIN / CREATE
  // ══════════════════════════════════════════════════════════════
  if (screen==="join") return (
    <Shell>
      <div style={{padding:"0 24px",paddingTop:56,paddingBottom:40}}>
        <button onClick={()=>setScreen("splash")} style={{background:"rgba(255,255,255,0.08)",border:"none",borderRadius:10,width:34,height:34,color:"#fff",fontSize:16,cursor:"pointer",marginBottom:24}}>‹</button>
        <div style={{fontSize:24,fontWeight:800,marginBottom:4}}>Join or Create</div>
        <div style={{fontSize:13,opacity:0.4,marginBottom:28,lineHeight:1.6}}>
          Room creator becomes <span style={{color:"#FB923C",fontWeight:600}}>Admin</span>. Others join as <span style={{color:"#94A3B8",fontWeight:600}}>Viewers</span>.<br/>Viewers can claim Admin with the PIN.
        </div>

        <div style={{fontSize:11,opacity:0.45,letterSpacing:0.8,marginBottom:8}}>YOUR NAME</div>
        <input value={nameInput} onChange={e=>{setNameInput(e.target.value);setJoinError("");}} placeholder="e.g. Arohi"
          style={{width:"100%",background:"rgba(255,255,255,0.07)",border:"1.5px solid rgba(255,255,255,0.12)",borderRadius:14,padding:"14px 16px",color:"#fff",fontSize:16,boxSizing:"border-box",outline:"none",marginBottom:22}}/>

        {/* Create */}
        <button onClick={createRoom} style={{width:"100%",padding:"16px",borderRadius:16,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#FB923C,#F97316)",color:"#fff",fontSize:15,fontWeight:700,boxShadow:"0 8px 28px rgba(251,146,60,0.35)",marginBottom:18}}>
          👑 Create Room as Admin
        </button>

        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
          <div style={{flex:1,height:1,background:"rgba(255,255,255,0.07)"}}/>
          <span style={{fontSize:11,opacity:0.3}}>OR JOIN AS VIEWER</span>
          <div style={{flex:1,height:1,background:"rgba(255,255,255,0.07)"}}/>
        </div>

        <div style={{fontSize:11,opacity:0.45,letterSpacing:0.8,marginBottom:8}}>ROOM ID</div>
        <input value={roomInput} onChange={e=>{setRoomInput(e.target.value.toUpperCase());setJoinError("");}} placeholder="e.g. AB12CD34"
          style={{width:"100%",background:"rgba(255,255,255,0.07)",border:"1.5px solid rgba(255,255,255,0.12)",borderRadius:14,padding:"14px 16px",color:"#fff",fontSize:16,fontFamily:"monospace",letterSpacing:2,boxSizing:"border-box",outline:"none",marginBottom:14}}/>
        {joinError&&<div style={{fontSize:13,color:"#EF4444",marginBottom:12,padding:"10px 14px",background:"rgba(239,68,68,0.1)",borderRadius:10}}>{joinError}</div>}
        <button onClick={joinRoom} style={{width:"100%",padding:"16px",borderRadius:16,border:"1.5px solid rgba(99,102,241,0.4)",cursor:"pointer",background:"rgba(99,102,241,0.12)",color:"#A5B4FC",fontSize:15,fontWeight:700}}>
          👁 Join as Viewer
        </button>
      </div>
    </Shell>
  );

  // ══════════════════════════════════════════════════════════════
  // MANAGE CATEGORIES (Admin only)
  // ══════════════════════════════════════════════════════════════
  if (subView==="manage-cats") return (
    <Shell>
      <TopBar title="Categories" onBack={()=>setSubView(null)} action={isAdmin?{label:"+ New",onClick:()=>setSubView("add-cat")}:null}/>
      <div style={{padding:"16px 20px 100px"}}>
        {!isAdmin&&<LockedNotice action="manage categories"/>}
        {categories.map(cat=>(
          <div key={cat.name} style={{display:"flex",alignItems:"center",gap:12,background:"rgba(255,255,255,0.05)",borderRadius:14,padding:"12px 14px",marginBottom:8,border:"1px solid rgba(255,255,255,0.06)"}}>
            <div style={{width:40,height:40,borderRadius:12,background:cat.color+"28",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,border:`1.5px solid ${cat.color}44`}}>{cat.icon}</div>
            <div style={{flex:1,fontSi
