import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL || "/api";
const emptyForm = { title:"", description:"", type:"lost", category:"Other", location:"", contact:"" };

function getItemImageUrl(image) {
  if (!image) return "";
  if (image.startsWith("data:") || image.startsWith("http://") || image.startsWith("https://")) {
    return image;
  }
  const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/api\/?$/, "");
  return `${apiBase}${image}`;
}

function App() {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState(emptyForm);
  const [image, setImage] = useState(null);
  const [message, setMessage] = useState("");
  const [matches, setMatches] = useState({});
  const [busy, setBusy] = useState(false);

  async function loadItems() {
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("type", filter);
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`${API}/items?${params}`);
      if (!response.ok) throw new Error("Could not load items");
      setItems(await response.json());
    } catch { setMessage("Could not load items from the server. Please check your connection."); }
  }
  useEffect(() => { loadItems(); }, [filter, query]);

  function updateForm(e) { setForm({ ...form, [e.target.name]: e.target.value }); }

  async function submitItem(e) {
    e.preventDefault(); setBusy(true); setMessage("");
    const data = new FormData();
    Object.entries(form).forEach(([key, value]) => data.append(key, value));
    if (image) data.append("image", image);
    try {
      const response = await fetch(`${API}/items`, { method:"POST", body:data });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not submit item");
      setForm(emptyForm); setImage(null); e.target.reset();
      setMessage("Your report was submitted successfully.");
      await loadItems();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function findMatches(id) {
    try {
      const response = await fetch(`${API}/items/${id}/matches`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setMatches(old => ({ ...old, [id]: data }));
    } catch (error) { setMessage(error.message); }
  }

  async function resolveItem(id) {
    const response = await fetch(`${API}/items/${id}/status`, {
      method:"PATCH", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ status:"resolved" })
    });
    if (response.ok) loadItems();
  }

  return <div className="page">
    <header className="hero">
      <div className="brand">🔎 LostLink</div>
      <p className="eyebrow">CAMPUS LOST & FOUND</p>
      <h1>Lost something?<br/><span>Let's bring it back.</span></h1>
      <p className="intro">A simple place for your campus community to report, discover, and reunite with lost belongings.</p>
      <a className="heroLink" href="#report">Report an item ↓</a>
    </header>

    <main>
      <section id="report" className="panel">
        <div className="sectionHead"><div><p className="eyebrow">CONTRIBUTE</p><h2>Report an item</h2></div></div>
        <form onSubmit={submitItem} className="formGrid">
          <label>Item name<input name="title" value={form.title} onChange={updateForm} required placeholder="e.g. Blue water bottle"/></label>
          <label>Report type<select name="type" value={form.type} onChange={updateForm}><option value="lost">I lost something</option><option value="found">I found something</option></select></label>
          <label>Category<select name="category" value={form.category} onChange={updateForm}><option>Other</option><option>Electronics</option><option>Books</option><option>Clothing</option><option>Accessories</option><option>Documents</option><option>Keys</option></select></label>
          <label>Campus location<input name="location" value={form.location} onChange={updateForm} required placeholder="e.g. Library, Block B"/></label>
          <label className="wide">Description<textarea name="description" value={form.description} onChange={updateForm} required rows="3" placeholder="Describe the item, colour, brand, and when it was lost or found."/></label>
          <label>Contact information<input name="contact" value={form.contact} onChange={updateForm} placeholder="Email or phone (optional)"/></label>
          <label>Item photo<input type="file" accept="image/*" onChange={e=>setImage(e.target.files[0] || null)}/><small>Optional; maximum 5 MB.</small></label>
          <button className="primary wide" disabled={busy}>{busy ? "Submitting..." : "Submit report"}</button>
        </form>
        {message && <p className="notice">{message}</p>}
      </section>

      <section className="listSection">
        <div className="sectionHead"><div><p className="eyebrow">COMMUNITY BOARD</p><h2>Recent reports</h2></div><span className="count">{items.length} reports</span></div>
        <div className="toolbar">
          <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search item, description, location..."/>
          <select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All reports</option><option value="lost">Lost</option><option value="found">Found</option></select>
        </div>
        <div className="cards">
          {items.map(item=><article className="itemCard" key={item.id}>
            {item.image ? <img className="itemImage" src={getItemImageUrl(item.image)} alt={item.title}/> : <div className="imagePlaceholder">📦</div>}
            <div className="itemBody">
              <div className="cardTop"><span className={`tag ${item.type}`}>{item.type}</span><span className="date">{new Date(item.createdAt).toLocaleDateString()}</span></div>
              <h3>{item.title}</h3><p>{item.description}</p>
              <p className="meta">📍 {item.location} · {item.category}</p>
              {item.contact && <p className="meta">Contact: {item.contact}</p>}
              <div className="actions"><button onClick={()=>findMatches(item.id)}>Find possible matches</button><button className="subtle" onClick={()=>resolveItem(item.id)}>Mark resolved</button></div>
              {matches[item.id] && <div className="matches"><strong>Possible matches</strong>{matches[item.id].length ? matches[item.id].map(m=><p key={m.item.id}>{m.item.title} — {Math.round(m.score*100)}% ({m.method})</p>) : <p>No matches found yet.</p>}</div>}
            </div>
          </article>)}
          {!items.length && <div className="empty">No reports found. Be the first to add one!</div>}
        </div>
      </section>
    </main>
    <footer>LostLink · Campus Lost & Found · Built to help belongings find their way home.</footer>
  </div>;
}
export default App;