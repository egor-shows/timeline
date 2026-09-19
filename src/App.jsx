import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import Papa from "papaparse";
import { SHEETS, YEAR_START, YEAR_END } from "./config.js";

const MONTHS_S = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];
const MONTHS_F = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const YCW = 148, MCW = 128, ROW_H = 56, LEADER_H = 26, CCW = 190;

// ── CSV LOADING ──────────────────────────────────────────────────

async function fetchCSV(url) {
  const res = await fetch(url);
  const text = await res.text();
  return Papa.parse(text, { header: true, skipEmptyLines: true }).data;
}

function parseCountries(rows) {
  const map = {};
  for (const r of rows) {
    const id = r.id?.trim();
    if (!id) continue;
    if (!map[id]) map[id] = { id, eras: [], sort: Number(r.sort_order) || 99 };
    map[id].eras.push({
      name: r.era_name?.trim() || id,
      emoji: r.emoji?.trim() || "",
      start: Number(r.era_start) || 0,
      end: r.era_end?.trim() ? Number(r.era_end) : 9999,
    });
  }
  return Object.values(map)
    .sort((a, b) => a.sort - b.sort)
    .map(c => ({ ...c, eras: c.eras.sort((a, b) => a.start - b.start) }));
}

function parseEvents(rows) {
  const events = {};  // { countryId: { year: { summary, detail, months: {m: text} } } }
  const links = {};   // { "cid-year": ["cid2-year2", ...] }
  const linkGroups = {}; // { groupName: ["cid-year", ...] }

  for (const r of rows) {
    const cid = r.country_id?.trim();
    const year = Number(r.year);
    if (!cid || !year) continue;

    if (!events[cid]) events[cid] = {};
    if (!events[cid][year]) events[cid][year] = { summary: "", detail: "", months: {} };

    const month = r.month?.trim();
    if (month === "" || month === undefined) {
      // year-level row
      if (r.summary?.trim()) events[cid][year].summary = r.summary.trim();
      if (r.detail?.trim()) events[cid][year].detail = r.detail.trim();
    } else {
      // month-level row
      const mi = Number(month);
      const text = r.summary?.trim() || "";
      if (text) events[cid][year].months[mi] = text;
      // if no year-level summary yet, use first month text
      if (!events[cid][year].summary && text) events[cid][year].summary = text;
    }

    // link groups
    const lg = r.link_group?.trim();
    if (lg) {
      const key = `${cid}-${year}`;
      if (!linkGroups[lg]) linkGroups[lg] = new Set();
      linkGroups[lg].add(key);
    }
  }

  // build links from groups
  for (const members of Object.values(linkGroups)) {
    const arr = [...members];
    for (const k of arr) {
      links[k] = arr.filter(x => x !== k);
    }
  }

  return { events, links };
}

function parseLeaders(rows) {
  const leaders = {};
  for (const r of rows) {
    const cid = r.country_id?.trim();
    if (!cid) continue;
    if (!leaders[cid]) leaders[cid] = [];
    leaders[cid].push([
      r.name?.trim() || "",
      Number(r.start_year) || 0,
      Number(r.start_month) || 0,
      Number(r.end_year) || 9999,
      Number(r.end_month) || 0,
      r.color?.trim() || "#888",
    ]);
  }
  return leaders;
}

// ── ERA HELPERS ──────────────────────────────────────────────────

function getEra(country, year) {
  if (!country?.eras) return { name: country?.id || "?", emoji: "" };
  for (let i = country.eras.length - 1; i >= 0; i--) {
    const e = country.eras[i];
    if (year >= e.start && year < e.end) return e;
  }
  return country.eras[country.eras.length - 1] || { name: "?", emoji: "" };
}

function getDisplayName(country, yearStart, yearEnd) {
  const mid = Math.round((yearStart + yearEnd) / 2);
  return getEra(country, mid);
}

// ── MAIN COMPONENT ───────────────────────────────────────────────

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [evRows, cRows, lRows] = await Promise.all([
          fetchCSV(SHEETS.events),
          fetchCSV(SHEETS.countries),
          fetchCSV(SHEETS.leaders),
        ]);
        const countries = parseCountries(cRows);
        const { events, links } = parseEvents(evRows);
        const leaders = parseLeaders(lRows);
        setData({ countries, events, links, leaders });
      } catch (e) {
        console.error(e);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div style={S.loadScreen}><div style={S.loadText}>Загрузка данных...</div></div>;
  if (error) return (
    <div style={S.loadScreen}>
      <div style={{ ...S.loadText, color: "#E25555" }}>Ошибка загрузки</div>
      <div style={{ color: "#8899AA", fontSize: 13, marginTop: 12, maxWidth: 500, textAlign: "center", lineHeight: "20px" }}>
        {error}<br/><br/>
        Проверь, что в <code style={{ color: "#6AB0F3" }}>src/config.js</code> указаны правильные URL опубликованных Google Sheets.
      </div>
    </div>
  );

  return <Timeline {...data} />;
}

// ── TIMELINE ─────────────────────────────────────────────────────

function Timeline({ countries, events, links, leaders }) {
  const [expandedYear, setExpandedYear] = useState(null);
  const [expandedCountries, setExpandedCountries] = useState(new Set());
  const [selected, setSelected] = useState(new Set(countries.map(c => c.id)));
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterQ, setFilterQ] = useState("");
  const [popup, setPopup] = useState(null);
  const [cursorX, setCursorX] = useState(null);
  const [highlight, setHighlight] = useState(null);
  const gridRef = useRef(null);
  const cListRef = useRef(null);
  const popupRef = useRef(null);
  const filterRef = useRef(null);

  const years = useMemo(() => { const a = []; for (let y = YEAR_START; y <= YEAR_END; y++) a.push(y); return a; }, []);
  const visible = useMemo(() => countries.filter(c => selected.has(c.id)), [countries, selected]);

  const yearPos = useMemo(() => {
    const m = {}; let x = 0;
    for (const y of years) { const w = y === expandedYear ? MCW * 12 : YCW; m[y] = { x, w }; x += w; }
    m._total = x;
    return m;
  }, [years, expandedYear]);

  const toX = useCallback((yr, mo) => {
    const cy = Math.max(YEAR_START, Math.min(YEAR_END, yr));
    const p = yearPos[cy];
    return p ? p.x + (mo / 12) * p.w : 0;
  }, [yearPos]);

  // close dropdowns on outside click
  useEffect(() => {
    const h = e => { if (filterRef.current && !filterRef.current.contains(e.target)) setFilterOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  useEffect(() => {
    const h = e => { if (popupRef.current && !popupRef.current.contains(e.target) && !e.target.closest("[data-ev]")) { setPopup(null); setHighlight(null); } };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);

  const handleGridMouseMove = useCallback(e => {
    if (!gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    setCursorX(e.clientX - rect.left + gridRef.current.scrollLeft);
  }, []);

  const toggleCountry = id => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSelected(new Set(countries.map(c => c.id)));
  const clearAll = () => setSelected(new Set());
  const toggleExpand = id => setExpandedCountries(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const openPopup = (e, cid, year, mi) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const key = `${cid}-${year}-${mi ?? "y"}`;
    if (popup?.key === key) { setPopup(null); setHighlight(null); return; }
    const ev = events[cid]?.[year]; if (!ev) return;
    const c = countries.find(x => x.id === cid);
    const era = getEra(c, year);

    const linkKey = `${cid}-${year}`;
    const linked = links[linkKey];
    setHighlight(linked ? new Set([linkKey, ...linked]) : new Set([linkKey]));

    setPopup({ key, rx: r.right, ry: r.top, rw: r.width, name: era.name, emoji: era.emoji, year, mi, summary: ev.summary, detail: ev.detail, months: ev.months, monthText: mi != null ? ev.months?.[mi] : null, cid });
  };

  const popPos = useMemo(() => {
    if (!popup) return {};
    let x = popup.rx + 10, y = popup.ry;
    if (x + 330 > window.innerWidth - 12) x = popup.rx - popup.rw - 340;
    if (x < 8) x = 8; if (y + 260 > window.innerHeight - 12) y = window.innerHeight - 272; if (y < 8) y = 8;
    return { left: x, top: y };
  }, [popup]);

  const syncScroll = e => { if (cListRef.current) cListRef.current.scrollTop = e.target.scrollTop; };
  const filteredDD = filterQ.trim() ? countries.filter(c => {
    const q = filterQ.toLowerCase();
    return c.eras.some(e => e.name.toLowerCase().includes(q)) || c.id.includes(q);
  }) : countries;

  const getOpacity = (cid, year) => !highlight ? 1 : highlight.has(`${cid}-${year}`) ? 1 : 0.18;
  const getGlow = (cid, year) => highlight && highlight.size > 1 && highlight.has(`${cid}-${year}`);

  const guideLeft = useMemo(() => {
    if (cursorX == null || !gridRef.current) return null;
    return cursorX - gridRef.current.scrollLeft;
  }, [cursorX]);

  const renderLeaders = (cid) => {
    const ls = leaders[cid]; if (!ls) return null;
    const total = yearPos._total;
    return ls.map(([name, sy, sm, ey, em, color], i) => {
      let x1 = toX(Math.max(sy, YEAR_START), sy < YEAR_START ? 0 : sm);
      let x2 = toX(Math.min(ey, YEAR_END), ey > YEAR_END ? 11.99 : em);
      if (sy < YEAR_START) x1 = 0; if (ey > YEAR_END) x2 = total;
      if (x2 <= x1) return null;
      return (
        <div key={i} style={{ position: "absolute", left: x1, width: x2 - x1, top: 3, height: LEADER_H - 6, background: color, borderRadius: 3, display: "flex", alignItems: "center", paddingLeft: 6, overflow: "hidden", whiteSpace: "nowrap" }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.5)", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
        </div>
      );
    });
  };

  return (
    <div style={S.root}>
      {/* Top bar */}
      <div style={S.bar}>
        <div style={S.logo}>Хронограф</div>
        <div ref={filterRef} style={{ position: "relative", zIndex: 50 }}>
          <div style={S.filterTrigger} onClick={() => setFilterOpen(p => !p)}>
            <span style={S.filterIcon}>⌕</span>
            <span style={S.filterLabel}>{selected.size === countries.length ? "Все страны" : selected.size === 0 ? "Нет стран" : `${selected.size} из ${countries.length}`}</span>
            <span style={{ fontSize: 10, color: "#4A5C72", marginLeft: 4 }}>▼</span>
          </div>
          {filterOpen && (
            <div style={S.dropdown}>
              <input style={S.ddSearch} placeholder="Поиск..." value={filterQ} onChange={e => setFilterQ(e.target.value)} autoFocus />
              <div style={S.ddActions}>
                <button style={S.ddBtn} onClick={selectAll}>Все</button>
                <button style={S.ddBtn} onClick={clearAll}>Очистить</button>
              </div>
              <div style={S.ddList}>
                {filteredDD.map(c => {
                  const era = getDisplayName(c, YEAR_START, YEAR_END);
                  return (
                    <label key={c.id} style={S.ddItem}>
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleCountry(c.id)} style={{ accentColor: "#6AB0F3", marginRight: 8 }} />
                      <span style={{ marginRight: 6 }}>{era.emoji}</span>
                      <span>{era.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div style={S.hint}>год → месяцы · событие → подробности · страна → лидеры</div>
      </div>

      <div style={S.body}>
        {/* Country column */}
        <div style={S.cCol}>
          <div style={S.cHead}>Страна</div>
          <div style={S.cList} ref={cListRef}>
            {visible.map((c, i) => {
              const isExp = expandedCountries.has(c.id);
              const era = getDisplayName(c, YEAR_START, YEAR_END);
              const h = isExp ? ROW_H + LEADER_H : ROW_H;
              return (
                <div key={c.id} style={{ ...S.cRow, height: h, background: i % 2 === 0 ? "#0C1119" : "transparent", cursor: "pointer", flexDirection: "column", alignItems: "stretch", justifyContent: "flex-end", padding: 0 }} onClick={() => toggleExpand(c.id)}>
                  {isExp && <div style={{ height: LEADER_H, padding: "0 12px", display: "flex", alignItems: "center", fontSize: 9, fontWeight: 600, color: "#4A5C72", textTransform: "uppercase", letterSpacing: "0.08em" }}>лидер</div>}
                  <div style={{ height: ROW_H, display: "flex", alignItems: "center", padding: "0 12px", gap: 8 }}>
                    <span style={S.cEmoji}>{era.emoji}</span>
                    <span style={{ ...S.cName, color: isExp ? "#6AB0F3" : "#A0B0C2" }}>{era.name}</span>
                    <span style={{ fontSize: 9, color: "#3E5570", marginLeft: "auto", transform: isExp ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Grid */}
        <div style={{ ...S.grid, position: "relative" }} ref={gridRef} onScroll={syncScroll} onMouseMove={handleGridMouseMove} onMouseLeave={() => setCursorX(null)}>
          {guideLeft != null && <div style={{ position: "absolute", top: 0, bottom: 0, left: guideLeft, width: 1, background: "rgba(106,176,243,0.35)", pointerEvents: "none", zIndex: 15 }} />}
          <div style={{ width: yearPos._total, minWidth: "100%" }}>
            {/* Header */}
            <div style={S.hdr}>
              {years.map(y => {
                const exp = y === expandedYear;
                const w = exp ? MCW * 12 : YCW;
                return (
                  <div key={y} style={{ ...S.yHdr, width: w, background: exp ? "#111D2B" : "transparent" }} onClick={() => { setExpandedYear(p => p === y ? null : y); setPopup(null); setHighlight(null); }}>
                    <span style={{ ...S.yLbl, color: exp ? "#6AB0F3" : "#8899AA", fontWeight: exp ? 700 : 500, fontSize: exp ? 14 : 13 }}>{y}</span>
                    <span style={{ ...S.yChev, transform: exp ? "rotate(180deg)" : "none" }}>▼</span>
                    {exp && <div style={S.mRow}>{MONTHS_S.map((m, mi) => <div key={mi} style={S.mLbl}>{m}</div>)}</div>}
                  </div>
                );
              })}
            </div>

            {/* Rows */}
            {visible.map((c, ci) => {
              const isExp = expandedCountries.has(c.id);
              const rowH = isExp ? ROW_H + LEADER_H : ROW_H;
              return (
                <div key={c.id} style={{ position: "relative", display: "flex", minHeight: rowH, borderBottom: "1px solid #111B27", background: ci % 2 === 0 ? "#0C1119" : "transparent" }}>
                  {isExp && <div style={{ position: "absolute", top: 0, left: 0, width: yearPos._total, height: LEADER_H, pointerEvents: "none", zIndex: 2 }}>{renderLeaders(c.id)}</div>}
                  {years.map(y => {
                    const yExp = y === expandedYear;
                    const ev = events[c.id]?.[y];
                    const op = getOpacity(c.id, y);
                    const glow = getGlow(c.id, y);
                    const gs = glow ? "0 0 8px rgba(106,176,243,0.5), 0 0 2px rgba(106,176,243,0.8)" : "none";
                    if (yExp) {
                      return MONTHS_S.map((_, mi) => {
                        const t = ev?.months?.[mi];
                        return <div key={`${y}-${mi}`} style={{ ...S.cell, width: MCW, paddingTop: isExp ? LEADER_H + 4 : 8 }} data-ev={t ? "1" : undefined} onClick={t ? e => openPopup(e, c.id, y, mi) : undefined}>{t && <div style={{ ...S.mTag, opacity: op, transition: "opacity 0.25s", boxShadow: gs }}>{t}</div>}</div>;
                      });
                    }
                    return <div key={y} style={{ ...S.cell, width: YCW, paddingTop: isExp ? LEADER_H + 4 : 8 }} data-ev={ev ? "1" : undefined} onClick={ev ? e => openPopup(e, c.id, y) : undefined}>{ev && <div style={{ ...S.yTag, opacity: op, transition: "opacity 0.25s", boxShadow: gs }}>{ev.summary}</div>}</div>;
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Popup */}
      {popup && (
        <div ref={popupRef} style={{ ...S.popup, ...popPos }}>
          <div style={S.pH}>
            <span style={{ fontSize: 15 }}>{popup.emoji}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#8CA0B8" }}>{popup.name}</span>
            <span style={S.pYear}>{popup.mi != null ? `${MONTHS_F[popup.mi]} ${popup.year}` : popup.year}</span>
            <button style={S.pClose} onClick={() => { setPopup(null); setHighlight(null); }}>✕</button>
          </div>
          <div style={S.pTitle}>{popup.summary}</div>
          {popup.detail && <div style={S.pDetail}>{popup.detail}</div>}
          {popup.mi == null && popup.months && Object.keys(popup.months).length > 0 && (
            <div style={S.pMonths}>{Object.entries(popup.months).sort(([a], [b]) => a - b).map(([mi, txt]) => (
              <div key={mi} style={S.pMRow}><span style={S.pMLbl}>{MONTHS_S[Number(mi)]}</span><span>{txt}</span></div>
            ))}</div>
          )}
          {popup.mi != null && popup.monthText && <div style={S.pMDet}>{popup.monthText}</div>}
          {highlight && highlight.size > 1 && popup.mi == null && (() => {
            const linkKey = `${popup.cid}-${popup.year}`;
            const linked = links[linkKey];
            if (!linked) return null;
            return (
              <div style={{ padding: "6px 14px 14px", borderTop: "1px solid #253850" }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#4A5C72", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Связанные события</div>
                {linked.map(lk => {
                  const [lcid, lyStr] = lk.split("-");
                  const ly = Number(lyStr);
                  const lc = countries.find(x => x.id === lcid);
                  const le = events[lcid]?.[ly];
                  if (!lc || !le) return null;
                  const lera = getEra(lc, ly);
                  return (
                    <div key={lk} style={{ fontSize: 12, color: "#A0B4C8", marginBottom: 4, display: "flex", gap: 6, alignItems: "baseline" }}>
                      <span style={{ fontSize: 13 }}>{lera.emoji}</span>
                      <span style={{ color: "#6AB0F3", fontWeight: 600 }}>{lera.name}:</span>
                      <span>{le.summary}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ── STYLES ───────────────────────────────────────────────────────
const S = {
  root: { background: "#0B1017", color: "#C8D1DB", fontFamily: "'Inter',-apple-system,BlinkMacSystemFont,sans-serif", fontSize: 13, height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" },
  loadScreen: { background: "#0B1017", height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" },
  loadText: { color: "#6AB0F3", fontSize: 16, fontFamily: "Georgia,serif" },
  bar: { padding: "12px 20px", display: "flex", alignItems: "center", gap: 16, borderBottom: "1px solid #1A2535", flexShrink: 0, background: "#0D1319" },
  logo: { fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 700, color: "#E8ECF0", letterSpacing: "0.02em", whiteSpace: "nowrap" },
  hint: { fontSize: 11, color: "#3E5570", whiteSpace: "nowrap", marginLeft: "auto" },
  filterTrigger: { display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", background: "#131B25", border: "1px solid #1E2E42", borderRadius: 6, cursor: "pointer", userSelect: "none", minWidth: 180 },
  filterIcon: { color: "#4A5C72", fontSize: 14 },
  filterLabel: { fontSize: 13, color: "#A0B0C2" },
  dropdown: { position: "absolute", top: "calc(100% + 6px)", left: 0, width: 260, background: "#141E2C", border: "1px solid #253850", borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", overflow: "hidden", zIndex: 100 },
  ddSearch: { width: "100%", padding: "9px 12px", background: "#0F1720", border: "none", borderBottom: "1px solid #1E2E42", color: "#C8D1DB", fontSize: 13, outline: "none", boxSizing: "border-box" },
  ddActions: { display: "flex", gap: 8, padding: "8px 12px", borderBottom: "1px solid #1A2535" },
  ddBtn: { background: "none", border: "1px solid #253850", borderRadius: 4, color: "#6AB0F3", fontSize: 11, padding: "3px 10px", cursor: "pointer" },
  ddList: { maxHeight: 260, overflowY: "auto", padding: "6px 0" },
  ddItem: { display: "flex", alignItems: "center", padding: "6px 12px", fontSize: 13, color: "#A0B0C2", cursor: "pointer", userSelect: "none" },
  body: { flex: 1, display: "flex", overflow: "hidden" },
  cCol: { width: CCW, flexShrink: 0, borderRight: "1px solid #1A2535", background: "#0B1017", zIndex: 20, display: "flex", flexDirection: "column" },
  cHead: { height: 46, display: "flex", alignItems: "center", padding: "0 16px", borderBottom: "1px solid #1A2535", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "#4A5C72", flexShrink: 0 },
  cList: { flex: 1, overflowY: "auto", overflowX: "hidden" },
  cRow: { display: "flex", alignItems: "center", padding: "0 12px", gap: 8, borderBottom: "1px solid #111B27", flexShrink: 0 },
  cEmoji: { fontSize: 15, flexShrink: 0, width: 22, textAlign: "center" },
  cName: { fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  grid: { flex: 1, overflow: "auto" },
  hdr: { display: "flex", height: 46, position: "sticky", top: 0, zIndex: 10, background: "#0D1319", borderBottom: "1px solid #1A2535" },
  yHdr: { flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", userSelect: "none", borderRight: "1px solid #151F2C", transition: "background 0.15s", position: "relative" },
  yLbl: { fontVariantNumeric: "tabular-nums", letterSpacing: "0.04em" },
  yChev: { fontSize: 8, color: "#4A5C72", marginTop: 1, transition: "transform 0.2s" },
  mRow: { display: "flex", width: "100%", position: "absolute", bottom: 2 },
  mLbl: { width: MCW, flexShrink: 0, textAlign: "center", fontSize: 10, fontWeight: 600, color: "#4A6580", textTransform: "uppercase", letterSpacing: "0.06em" },
  cell: { flexShrink: 0, padding: "8px 6px", borderRight: "1px solid #111B27", display: "flex", alignItems: "flex-start", minHeight: ROW_H, cursor: "default" },
  yTag: { fontSize: 11, lineHeight: "16px", color: "#B8C8D8", padding: "4px 8px", background: "#162030", borderRadius: 4, borderLeft: "2.5px solid #3B82C4", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" },
  mTag: { fontSize: 11, lineHeight: "16px", color: "#D4DDE6", padding: "4px 8px", background: "#18253A", borderRadius: 4, borderLeft: "2.5px solid #D4A54A", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" },
  popup: { position: "fixed", zIndex: 1000, width: 330, background: "#141E2C", border: "1px solid #253850", borderRadius: 10, boxShadow: "0 8px 36px rgba(0,0,0,0.6)", overflow: "hidden" },
  pH: { display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", background: "#18253A", borderBottom: "1px solid #253850" },
  pYear: { marginLeft: "auto", fontVariantNumeric: "tabular-nums", color: "#6AB0F3", fontSize: 12, fontWeight: 600 },
  pClose: { background: "none", border: "none", color: "#5A6E84", cursor: "pointer", fontSize: 15, padding: "0 0 0 6px", lineHeight: 1 },
  pTitle: { padding: "12px 14px 4px", fontSize: 15, fontWeight: 600, color: "#E4ECF2", lineHeight: "21px" },
  pDetail: { padding: "4px 14px 10px", fontSize: 12.5, color: "#8CA0B8", lineHeight: "19px" },
  pMonths: { padding: "2px 14px 14px", display: "flex", flexDirection: "column", gap: 7 },
  pMRow: { fontSize: 12, color: "#A0B4C8", lineHeight: "17px", display: "flex", gap: 10, alignItems: "baseline" },
  pMLbl: { flexShrink: 0, width: 32, fontWeight: 700, color: "#D4A54A", fontSize: 11 },
  pMDet: { padding: "4px 14px 14px", fontSize: 12.5, color: "#A0B4C8", lineHeight: "19px" },
};
