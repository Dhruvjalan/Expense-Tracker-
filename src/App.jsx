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
            <div style={{flex:1,fontSize:14,fontWeight:500}}>{cat.name}</div>
            {isAdmin&&!DEFAULT_CATEGORIES.find(d=>d.name===cat.name)&&(
              <button onClick={()=>deleteCategory(cat.name)} style={{background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:8,color:"#EF4444",fontSize:12,padding:"5px 10px",cursor:"pointer"}}>Remove</button>
            )}
          </div>
        ))}
      </div>
      <Toast toast={toast}/>
    </Shell>
  );

  if (subView==="add-cat") return (
    <Shell>
      <TopBar title="New Category" onBack={()=>setSubView("manage-cats")}/>
      <div style={{padding:"16px 20px 100px"}}>
        <Label>NAME</Label>
        <TextInput value={newCat.name} onChange={v=>setNewCat({...newCat,name:v})} placeholder="e.g. Groceries"/>
        <Label style={{marginTop:18}}>ICON</Label>
        <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:18}}>
          {CAT_ICONS.map(ic=><button key={ic} onClick={()=>setNewCat({...newCat,icon:ic})} style={{width:44,height:44,borderRadius:12,fontSize:22,border:`2px solid ${newCat.icon===ic?"#6366F1":"rgba(255,255,255,0.08)"}`,background:newCat.icon===ic?"rgba(99,102,241,0.2)":"rgba(255,255,255,0.05)",cursor:"pointer"}}>{ic}</button>)}
        </div>
        <Label>COLOR</Label>
        <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:22}}>
          {CAT_COLORS.map(cl=><button key={cl} onClick={()=>setNewCat({...newCat,color:cl})} style={{width:36,height:36,borderRadius:10,background:cl,border:`3px solid ${newCat.color===cl?"#fff":"transparent"}`,cursor:"pointer"}}/>)}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12,background:"rgba(255,255,255,0.05)",borderRadius:14,padding:"14px",marginBottom:24}}>
          <div style={{width:44,height:44,borderRadius:14,background:newCat.color+"28",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,border:`1.5px solid ${newCat.color}55`}}>{newCat.icon}</div>
          <span style={{fontSize:15,fontWeight:600,opacity:newCat.name?1:0.3}}>{newCat.name||"Preview"}</span>
        </div>
        <PrimaryBtn onClick={addCategory}>Add Category</PrimaryBtn>
      </div>
      <Toast toast={toast}/>
    </Shell>
  );

  // ══════════════════════════════════════════════════════════════
  // MANAGE MEMBERS (Admin only)
  // ══════════════════════════════════════════════════════════════
  if (subView==="manage-members") return (
    <Shell>
      <TopBar title="Members" onBack={()=>setSubView(null)} action={isAdmin?{label:"+ New",onClick:()=>setSubView("add-member")}:null}/>
      <div style={{padding:"16px 20px 100px"}}>
        {!isAdmin&&<LockedNotice action="manage members"/>}
        {members.map(m=>(
          <div key={m} style={{display:"flex",alignItems:"center",gap:12,background:"rgba(255,255,255,0.05)",borderRadius:14,padding:"12px 16px",marginBottom:8,border:"1px solid rgba(255,255,255,0.06)"}}>
            <div style={{width:36,height:36,borderRadius:10,background:"rgba(99,102,241,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>👤</div>
            <div style={{flex:1,fontSize:14,fontWeight:500}}>{m}</div>
            {isAdmin&&!DEFAULT_MEMBERS.includes(m)&&(
              <button onClick={()=>deleteMember(m)} style={{background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:8,color:"#EF4444",fontSize:12,padding:"5px 10px",cursor:"pointer"}}>Remove</button>
            )}
          </div>
        ))}
      </div>
      <Toast toast={toast}/>
    </Shell>
  );

  if (subView==="add-member") return (
    <Shell>
      <TopBar title="New Member" onBack={()=>setSubView("manage-members")}/>
      <div style={{padding:"16px 20px 100px"}}>
        <Label>NAME</Label>
        <TextInput value={newMember} onChange={setNewMember} placeholder="e.g. Riya"/>
        <div style={{height:18}}/>
        <PrimaryBtn onClick={addMember}>Add Member</PrimaryBtn>
      </div>
      <Toast toast={toast}/>
    </Shell>
  );

  // ══════════════════════════════════════════════════════════════
  // MAIN APP
  // ══════════════════════════════════════════════════════════════
  return (
    <Shell>
      {/* PIN prompt modal */}
      {pinPrompt&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",backdropFilter:"blur(6px)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
          <div style={{background:"#161622",borderRadius:"24px 24px 0 0",padding:"28px 24px 40px",width:"100%",maxWidth:430,border:"1px solid rgba(255,255,255,0.08)"}}>
            <div style={{fontSize:18,fontWeight:700,marginBottom:6}}>Enter Admin PIN</div>
            <div style={{fontSize:13,opacity:0.4,marginBottom:20}}>Enter the 4-digit PIN from when this room was created.</div>
            <input value={pinInput} onChange={e=>{setPinInput(e.target.value);setPinError("");}} placeholder="••••"
              type="number" maxLength={4}
              style={{width:"100%",background:"rgba(255,255,255,0.07)",border:`1.5px solid ${pinError?"#EF4444":"rgba(255,255,255,0.12)"}`,borderRadius:14,padding:"14px 16px",color:"#fff",fontSize:24,fontFamily:"monospace",letterSpacing:6,textAlign:"center",boxSizing:"border-box",outline:"none",marginBottom:10}}/>
            {pinError&&<div style={{fontSize:12,color:"#EF4444",marginBottom:10,textAlign:"center"}}>{pinError}</div>}
            <button onClick={claimAdmin} style={{width:"100%",padding:"15px",borderRadius:14,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#FB923C,#F97316)",color:"#fff",fontSize:15,fontWeight:700,marginBottom:12}}>
              Unlock Admin Access
            </button>
            <button onClick={()=>{setPinPrompt(false);setPinInput("");setPinError("");}} style={{width:"100%",padding:"13px",borderRadius:14,border:"1px solid rgba(255,255,255,0.1)",cursor:"pointer",background:"transparent",color:"rgba(255,255,255,0.4)",fontSize:14}}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Status bar */}
      <div style={{height:44,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 18px",position:"relative",zIndex:1}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <RoleBadge isAdmin={isAdmin}/>
          {!isAdmin&&(
            <button onClick={()=>setPinPrompt(true)} style={{background:"rgba(251,146,60,0.12)",border:"1px solid rgba(251,146,60,0.25)",borderRadius:20,padding:"3px 9px",fontSize:11,color:"#FB923C",fontWeight:600,cursor:"pointer"}}>
              🔑 Claim
            </button>
          )}
        </div>
        {/* Room badge */}
        <div style={{display:"flex",alignItems:"center",gap:5,background:"rgba(255,255,255,0.06)",borderRadius:20,padding:"4px 11px",cursor:"pointer"}} onClick={()=>{navigator.clipboard?.writeText(roomId);showToast("Room ID copied!","#10B981");}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:syncing?"#FFB347":"#10B981",boxShadow:`0 0 5px ${syncing?"#FFB347":"#10B981"}`}}/>
          <span style={{fontSize:11,fontWeight:700,letterSpacing:1.5,fontFamily:"monospace"}}>{roomId}</span>
        </div>
        <span style={{fontSize:11,opacity:0.35}}>{onlineUsers.length} 🟢</span>
      </div>

      <div style={{padding:"0 20px 110px",position:"relative",zIndex:1}}>

        {/* ── LIST VIEW ── */}
        {view==="list"&&(
          <>
            {/* Hero */}
            <div style={{background:"linear-gradient(135deg,#6366F1 0%,#8B5CF6 60%,#A78BFA 100%)",borderRadius:22,padding:"20px 20px 16px",marginBottom:14,marginTop:4,boxShadow:"0 20px 60px rgba(99,102,241,0.3)"}}>
              <div style={{fontSize:11,opacity:0.8,letterSpacing:0.5,marginBottom:4}}>THIS MONTH</div>
              <div style={{fontSize:32,fontWeight:700,letterSpacing:-1}}>{fmt(monthTotal)}</div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginTop:8}}>
                <div style={{fontSize:11,opacity:0.65}}>{expenses.filter(e=>e.date.startsWith(monthKey)).length} transactions</div>
                <div style={{display:"flex",gap:3}}>
                  {onlineUsers.slice(0,5).map((u,i)=>(
                    <div key={u.name} title={`${u.name} (${u.role})`} style={{width:24,height:24,borderRadius:"50%",background:u.role==="admin"?"#FB923C":`hsl(${(i*97+200)%360},55%,55%)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#fff",border:"2px solid rgba(99,102,241,0.7)",marginLeft:i>0?-5:0}}>
                      {u.name[0].toUpperCase()}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Viewer banner */}
            {!isAdmin&&(
              <div style={{display:"flex",alignItems:"center",gap:10,background:"rgba(148,163,184,0.07)",border:"1px solid rgba(148,163,184,0.15)",borderRadius:14,padding:"10px 14px",marginBottom:12}}>
                <span style={{fontSize:18}}>👁</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:600,color:"#94A3B8"}}>Viewer Mode</div>
                  <div style={{fontSize:11,opacity:0.4,marginTop:1}}>You can view & filter. Tap "Claim" to become Admin.</div>
                </div>
              </div>
            )}

            {/* Category filters */}
            <div style={{display:"flex",gap:7,overflowX:"auto",scrollbarWidth:"none",paddingBottom:2,marginBottom:8}}>
              <FilterPill label="All" active={filterCat==="All"} onClick={()=>setFilterCat("All")}/>
              {categories.map(c=><FilterPill key={c.name} label={c.icon+" "+c.name.split(" ")[0]} active={filterCat===c.name} onClick={()=>setFilterCat(c.name)}/>)}
            </div>
            {/* Member filters */}
            <div style={{display:"flex",gap:7,overflowX:"auto",scrollbarWidth:"none",paddingBottom:2,marginBottom:16}}>
              <FilterPill label="👥 All" active={filterMember==="All"} onClick={()=>setFilterMember("All")} accent="#10B981"/>
              {members.map(m=><FilterPill key={m} label={"👤 "+m} active={filterMember===m} onClick={()=>setFilterMember(m)} accent="#10B981"/>)}
            </div>

            {filtered.length===0?(
              <div style={{textAlign:"center",opacity:0.28,marginTop:50}}>
                <div style={{fontSize:42,marginBottom:10}}>💸</div>
                <div style={{fontSize:14}}>No expenses yet</div>
                {!isAdmin&&<div style={{fontSize:12,marginTop:6}}>Ask the Admin to add expenses</div>}
              </div>
            ):filtered.map((exp,i)=>{
              const cat=getCat(exp.category);
              return(
                <div key={exp.id} style={{background:"rgba(255,255,255,0.05)",borderRadius:16,padding:"13px 14px",marginBottom:9,display:"flex",alignItems:"center",gap:12,border:"1px solid rgba(255,255,255,0.06)",animation:`fadeIn 0.25s ease ${i*0.03}s both`}}>
                  <div style={{width:44,height:44,borderRadius:13,background:cat.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:21,flexShrink:0,border:`1.5px solid ${cat.color}44`}}>{cat.icon}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:2}}>{exp.category}</div>
                    <div style={{fontSize:11,opacity:0.4,display:"flex",flexWrap:"wrap",gap:"2px 6px"}}>
                      <span>{fmtDate(exp.date)}</span>
                      <span>· {exp.source}</span>
                      <span style={{color:"#A5B4FC"}}>· {exp.spentBy}</span>
                      {exp.addedBy&&<span style={{color:"#6EE7B7"}}>· by {exp.addedBy}</span>}
                      {exp.note&&<span>· {exp.note}</span>}
                    </div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:15,fontWeight:700,color:"#FF6B6B"}}>{fmt(exp.amount)}</div>
                    {isAdmin&&<button onClick={()=>deleteExpense(exp.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:10,color:"rgba(255,255,255,0.2)",marginTop:2}}>✕</button>}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* ── ADD VIEW ── */}
        {view==="add"&&(
          <>
            <div style={{fontSize:22,fontWeight:700,marginBottom:14,marginTop:4}}>New Expense</div>
            {!isAdmin?(
              <>
                <LockedNotice action="add expenses"/>
                <div style={{textAlign:"center",marginTop:40,opacity:0.3}}>
                  <div style={{fontSize:48,marginBottom:12}}>🔒</div>
                  <div style={{fontSize:14}}>Only the Admin can add expenses.</div>
                  <button onClick={()=>setPinPrompt(true)} style={{marginTop:20,padding:"12px 24px",borderRadius:14,border:"1px solid rgba(251,146,60,0.35)",background:"rgba(251,146,60,0.1)",color:"#FB923C",fontSize:14,fontWeight:600,cursor:"pointer"}}>
                    🔑 Enter PIN to become Admin
                  </button>
                </div>
              </>
            ):(
              <>
                <Label>AMOUNT (₹)</Label>
                <input type="number" placeholder="0" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}
                  style={{width:"100%",background:"rgba(255,255,255,0.07)",border:"1.5px solid rgba(255,255,255,0.1)",borderRadius:14,padding:"14px 16px",color:"#fff",fontSize:28,fontWeight:700,boxSizing:"border-box",outline:"none",marginBottom:16}}/>

                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <Label style={{margin:0}}>CATEGORY</Label>
                  <button onClick={()=>setSubView("manage-cats")} style={{fontSize:11,color:"#A5B4FC",background:"none",border:"none",cursor:"pointer"}}>Manage ›</button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16}}>
                  {categories.map(cat=>(
                    <button key={cat.name} onClick={()=>setForm({...form,category:cat.name})} style={{padding:"10px 4px",borderRadius:13,border:`1.5px solid ${form.category===cat.name?cat.color:"rgba(255,255,255,0.08)"}`,background:form.category===cat.name?cat.color+"22":"rgba(255,255,255,0.04)",cursor:"pointer",textAlign:"center"}}>
                      <div style={{fontSize:20}}>{cat.icon}</div>
                      <div style={{fontSize:10,color:"rgba(255,255,255,0.65)",marginTop:3,lineHeight:1.2}}>{cat.name.split(" ")[0]}</div>
                    </button>
                  ))}
                </div>

                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <Label style={{margin:0}}>SPENT BY</Label>
                  <button onClick={()=>setSubView("manage-members")} style={{fontSize:11,color:"#A5B4FC",background:"none",border:"none",cursor:"pointer"}}>Manage ›</button>
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:16}}>
                  {members.map(m=>(
                    <button key={m} onClick={()=>setForm({...form,spentBy:m})} style={{padding:"9px 14px",borderRadius:20,border:`1.5px solid ${form.spentBy===m?"#10B981":"rgba(255,255,255,0.08)"}`,background:form.spentBy===m?"rgba(16,185,129,0.15)":"rgba(255,255,255,0.05)",color:form.spentBy===m?"#6EE7B7":"rgba(255,255,255,0.6)",fontSize:13,fontWeight:500,cursor:"pointer"}}>{m}</button>
                  ))}
                </div>

                <Label>PAYMENT SOURCE</Label>
                <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:16}}>
                  {SOURCES.map(src=>(
                    <button key={src} onClick={()=>setForm({...form,source:src})} style={{padding:"9px 14px",borderRadius:20,border:`1.5px solid ${form.source===src?"#6366F1":"rgba(255,255,255,0.08)"}`,background:form.source===src?"rgba(99,102,241,0.2)":"rgba(255,255,255,0.05)",color:form.source===src?"#A5B4FC":"rgba(255,255,255,0.6)",fontSize:13,fontWeight:500,cursor:"pointer"}}>{src}</button>
                  ))}
                </div>

                <Label>DATE</Label>
                <input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}
                  style={{width:"100%",background:"rgba(255,255,255,0.07)",border:"1.5px solid rgba(255,255,255,0.1)",borderRadius:14,padding:"14px 16px",color:"#fff",fontSize:15,boxSizing:"border-box",outline:"none",colorScheme:"dark",marginBottom:14}}/>

                <Label>NOTE (OPTIONAL)</Label>
                <input type="text" placeholder="Add a note…" value={form.note} onChange={e=>setForm({...form,note:e.target.value})}
                  style={{width:"100%",background:"rgba(255,255,255,0.07)",border:"1.5px solid rgba(255,255,255,0.1)",borderRadius:14,padding:"14px 16px",color:"#fff",fontSize:15,boxSizing:"border-box",outline:"none",marginBottom:24}}/>

                <PrimaryBtn onClick={addExpense}>Add Expense</PrimaryBtn>
              </>
            )}
          </>
        )}

        {/* ── ANALYTICS VIEW ── */}
        {view==="stats"&&(
          <>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,marginTop:4}}>
              <div style={{fontSize:22,fontWeight:700}}>Analytics</div>
              {isAdmin?(
                <button onClick={exportToExcel} style={{display:"flex",alignItems:"center",gap:5,background:"linear-gradient(135deg,#10B981,#059669)",border:"none",borderRadius:12,padding:"9px 14px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",boxShadow:"0 4px 16px rgba(16,185,129,0.3)"}}>
                  ⬇ Excel
                </button>
              ):(
                <div style={{display:"flex",alignItems:"center",gap:5,background:"rgba(148,163,184,0.08)",border:"1px solid rgba(148,163,184,0.15)",borderRadius:12,padding:"9px 14px"}}>
                  <span style={{fontSize:12,color:"rgba(148,163,184,0.5)"}}>🔒 Admin only</span>
                </div>
              )}
            </div>

            {/* Room share card */}
            <div style={{background:"rgba(99,102,241,0.09)",border:"1px solid rgba(99,102,241,0.22)",borderRadius:18,padding:"16px",marginBottom:16}}>
              <div style={{fontSize:11,opacity:0.45,letterSpacing:0.8,marginBottom:10}}>ROOM · SHARE WITH OTHERS</div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                <div>
                  <div style={{fontSize:20,fontWeight:800,letterSpacing:3,fontFamily:"monospace",color:"#A5B4FC"}}>{roomId}</div>
                  <div style={{fontSize:11,opacity:0.35,marginTop:3}}>syncs every 4s</div>
                </div>
                <button onClick={()=>{navigator.clipboard?.writeText(roomId);showToast("Copied!","#10B981");}} style={{background:"rgba(99,102,241,0.2)",border:"1px solid rgba(99,102,241,0.35)",borderRadius:12,padding:"9px 13px",color:"#A5B4FC",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                  📋 Copy
                </button>
              </div>
              {/* Online users with roles */}
              {onlineUsers.length>0&&(
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {onlineUsers.map(u=>(
                    <div key={u.name} style={{display:"flex",alignItems:"center",gap:5,background:"rgba(255,255,255,0.05)",borderRadius:20,padding:"4px 10px",border:`1px solid ${u.role==="admin"?"rgba(251,146,60,0.3)":"rgba(255,255,255,0.08)"}`}}>
                      <div style={{width:7,height:7,borderRadius:"50%",background:u.role==="admin"?"#FB923C":"#10B981"}}/>
                      <span style={{fontSize:11,fontWeight:500}}>{u.name}{u.name===myName?" (you)":""}</span>
                      <span style={{fontSize:10,opacity:0.45}}>{u.role==="admin"?"👑":""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:18}}>
              <StatCard label="This Month" value={fmt(monthTotal)} sub={expenses.filter(e=>e.date.startsWith(monthKey)).length+" txns"}/>
              <StatCard label="All Time"   value={fmt(allTotal)}   sub={expenses.length+" txns"}/>
            </div>

            <SectionLabel>BY CATEGORY</SectionLabel>
            {catTotals.length===0?<EmptyNote/>:catTotals.map(c=><BarRow key={c.name} label={c.icon+" "+c.name} value={fmt(c.total)} pct={c.total/maxCat} color={c.color}/>)}

            <SectionLabel style={{marginTop:20}}>BY MEMBER</SectionLabel>
            {memTotals.length===0?<EmptyNote/>:memTotals.map(m=><BarRow key={m.name} label={"👤 "+m.name} value={fmt(m.total)} pct={m.total/maxMem} color="#6366F1"/>)}

            <SectionLabel style={{marginTop:20}}>BY SOURCE</SectionLabel>
            {SOURCES.map(src=>{
              const total=expenses.filter(e=>e.source===src).reduce((s,e)=>s+e.amount,0);
              if(!total) return null;
              return(
                <div key={src} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"rgba(255,255,255,0.04)",borderRadius:12,padding:"11px 14px",marginBottom:7,border:"1px solid rgba(255,255,255,0.05)"}}>
                  <span style={{fontSize:13}}>{src}</span>
                  <span style={{fontSize:13,fontWeight:700,color:"#A5B4FC"}}>{fmt(total)}</span>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Bottom nav — Add tab hidden for Viewers */}
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:"rgba(10,10,15,0.93)",backdropFilter:"blur(20px)",borderTop:"1px solid rgba(255,255,255,0.07)",display:"flex",padding:"10px 0 26px",zIndex:50}}>
        {[{id:"list",icon:"📋",label:"Expenses"},{id:"add",icon:"➕",label:"Add"},{id:"stats",icon:"📊",label:"Analytics"}].map(tab=>(
          <button key={tab.id} onClick={()=>setView(tab.id)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3,background:"none",border:"none",cursor:"pointer",opacity:tab.id==="add"&&!isAdmin?0.35:1}}>
            {tab.id==="add"?(
              <div style={{width:50,height:50,borderRadius:15,marginTop:-26,background:isAdmin?"linear-gradient(135deg,#6366F1,#8B5CF6)":"rgba(100,116,139,0.4)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:isAdmin?22:18,boxShadow:isAdmin?"0 8px 24px rgba(99,102,241,0.5)":"none",border:"3px solid rgb(10,10,15)"}}>
                {isAdmin?"➕":"🔒"}
              </div>
            ):(
              <div style={{fontSize:22}}>{tab.icon}</div>
            )}
            <span style={{fontSize:11,fontWeight:500,color:view===tab.id?"#A5B4FC":"rgba(255,255,255,0.28)"}}>{tab.label}</span>
          </button>
        ))}
      </div>

      <Toast toast={toast}/>
      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        input[type=number]::-webkit-outer-spin-button,input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none}
        *{-webkit-tap-highlight-color:transparent}
        ::-webkit-scrollbar{display:none}
        input::placeholder{color:rgba(255,255,255,0.25)}
      `}</style>
    </Shell>
  );
}

// ── Shared components ──────────────────────────────────────────
function Shell({children}){return(<div style={{fontFamily:"'SF Pro Display',-apple-system,BlinkMacSystemFont,sans-serif",background:"#0A0A0F",minHeight:"100vh",maxWidth:430,margin:"0 auto",color:"#F5F5F7",position:"relative",overflowX:"hidden"}}><div style={{position:"fixed",top:-80,left:"50%",transform:"translateX(-50%)",width:280,height:280,borderRadius:"50%",background:"radial-gradient(circle,rgba(99,102,241,0.13) 0%,transparent 70%)",pointerEvents:"none",zIndex:0}}/>{children}</div>);}
function TopBar({title,onBack,action}){return(<div style={{height:56,display:"flex",alignItems:"center",padding:"0 20px",gap:12,borderBottom:"1px solid rgba(255,255,255,0.06)",position:"sticky",top:0,background:"rgba(10,10,15,0.95)",backdropFilter:"blur(12px)",zIndex:10}}><button onClick={onBack} style={{background:"rgba(255,255,255,0.08)",border:"none",borderRadius:10,width:34,height:34,color:"#fff",fontSize:16,cursor:"pointer",flexShrink:0}}>‹</button><div style={{flex:1,fontSize:16,fontWeight:700}}>{title}</div>{action&&<button onClick={action.onClick} style={{background:"rgba(99,102,241,0.2)",border:"1px solid rgba(99,102,241,0.35)",borderRadius:10,padding:"6px 12px",color:"#A5B4FC",fontSize:13,fontWeight:600,cursor:"pointer"}}>{action.label}</button>}</div>);}
function Label({children,style}){return <div style={{fontSize:11,opacity:0.45,marginBottom:8,letterSpacing:0.8,...style}}>{children}</div>;}
function SectionLabel({children,style}){return <div style={{fontSize:11,opacity:0.4,marginBottom:10,letterSpacing:0.8,...style}}>{children}</div>;}
function TextInput({value,onChange,placeholder}){return <input type="text" value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{width:"100%",background:"rgba(255,255,255,0.07)",border:"1.5px solid rgba(255,255,255,0.1)",borderRadius:14,padding:"14px 16px",color:"#fff",fontSize:15,boxSizing:"border-box",outline:"none",marginBottom:4}}/>;}
function PrimaryBtn({onClick,children}){return <button onClick={onClick} style={{width:"100%",padding:"16px",borderRadius:16,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#6366F1,#8B5CF6)",color:"#fff",fontSize:16,fontWeight:700,boxShadow:"0 8px 28px rgba(99,102,241,0.4)"}}>{children}</button>;}
function FilterPill({label,active,onClick,accent="#6366F1"}){return <button onClick={onClick} style={{padding:"6px 13px",borderRadius:20,border:"none",cursor:"pointer",whiteSpace:"nowrap",fontSize:12,fontWeight:500,background:active?accent:"rgba(255,255,255,0.07)",color:active?"#fff":"rgba(255,255,255,0.55)",flexShrink:0,transition:"all 0.15s"}}>{label}</button>;}
function StatCard({label,value,sub}){return(<div style={{background:"rgba(255,255,255,0.05)",borderRadius:18,padding:"16px",border:"1px solid rgba(255,255,255,0.06)"}}><div style={{fontSize:11,opacity:0.45,marginBottom:6}}>{label}</div><div style={{fontSize:20,fontWeight:700}}>{value}</div><div style={{fontSize:11,opacity:0.35,marginTop:4}}>{sub}</div></div>);}
function BarRow({label,value,pct,color}){return(<div style={{marginBottom:12}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span style={{fontSize:13}}>{label}</span><span style={{fontSize:13,fontWeight:700,color}}>{value}</span></div><div style={{height:5,background:"rgba(255,255,255,0.07)",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",borderRadius:3,width:`${pct*100}%`,background:color,transition:"width 0.6s ease"}}/></div></div>);}
function EmptyNote(){return <div style={{fontSize:13,opacity:0.25,padding:"20px 0"}}>No data yet</div>;}
function Toast({toast}){if(!toast) return null; return <div style={{position:"fixed",bottom:95,left:"50%",transform:"translateX(-50%)",background:toast.color||"#6366F1",padding:"10px 22px",borderRadius:24,fontSize:13,fontWeight:600,boxShadow:"0 8px 28px rgba(0,0,0,0.4)",zIndex:200,whiteSpace:"nowrap",color:"#fff"}}>{toast.msg}</div>;}
