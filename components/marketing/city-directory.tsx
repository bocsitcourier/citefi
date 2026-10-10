"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ArrowUpRight, MapPin, X } from "lucide-react";
import cityData from "@/lib/marketing/cities.json";

type City = (typeof cityData.cities)[number];
const cities = [...new Map(cityData.cities.map((city) => [city.slug, city])).values()];
export default function CityDirectory() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState("");
  const states = useMemo(() => [...new Set(cities.map((c) => c.state))].sort(), []);
  const results = useMemo(() => cities.filter((c) =>
    (!state || c.state === state) && (!query || `${c.name} ${c.state}`.toLowerCase().includes(query.trim().toLowerCase()))
  ).sort((a, b) => a.name.localeCompare(b.name) || a.state.localeCompare(b.state)), [query, state]);
  return <div className="city-directory">
    <div className="directory-title"><div><div className="eyebrow">Pick a place to begin</div><h2>Find where you work.</h2></div><p>Online content support for local businesses. Not a local-office map.</p></div>
    <div className="directory-controls">
      <label className="search-field"><Search size={18} /><span className="sr-only">Search cities</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search city or state" /><span className="search-shortcut">SEARCH</span></label>
      <label className="state-select"><span className="sr-only">Filter by state</span><select value={state} onChange={(e) => setState(e.target.value)}><option value="">All states</option>{states.map((s) => <option key={s}>{s}</option>)}</select></label>
      {(query || state) && <button className="clear-filters" onClick={() => { setQuery(""); setState(""); }}><X size={14} /> Clear filters</button>}
    </div>
    <p className="result-count" aria-live="polite"><MapPin size={14} /> Showing {results.length} {results.length === 1 ? "place" : "places"}{state ? ` in ${state}` : ""}</p>
    {results.length ? <div className="city-grid">{results.map((city: City, i) => <Link key={city.slug} href={`/cities/${city.slug}`} className="city-item"><span className="city-sequence">{String(i + 1).padStart(2, "0")}</span><span><b>{city.name}</b><small>{city.state}</small></span><ArrowUpRight size={16} /></Link>)}</div> : <div className="empty-search"><b>No matching places</b><span>Try another spelling or clear a filter to see more locations.</span><button onClick={() => { setQuery(""); setState(""); }}>Reset search</button></div>}
  </div>;
}
