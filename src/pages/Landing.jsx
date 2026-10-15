import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import TpLogo from '../components/TpLogo';

const FAQS = [
  { q: 'Is the load board really free?', a: 'Yes — completely free for carriers. Trucker Path gives carriers free unlimited access to 150,000+ loads daily, with no subscription required. AI matching and advanced features are available for premium accounts.' },
  { q: 'How accurate is the truck GPS routing?', a: 'Our routing engine uses your truck\'s exact specs — height, weight, length, hazmat class — and is updated daily with restriction data from 50 state DOT databases. Over 5 billion miles have been routed through our system since 2013.' },
  { q: 'What fleet size qualifies for Fleet Navigation?', a: 'Fleet Navigation is designed for companies with 3 or more trucks. For owner-operators with 1–2 trucks, the Trucker Path Driver App provides full GPS, POI, and load board functionality for free.' },
  { q: 'Does Trucker Path work offline?', a: 'Yes. Maps and navigation work offline. Downloaded regions continue to function in dead zones — critical for rural routes. Tracking data queues locally and syncs automatically when connectivity resumes.' },
  { q: 'How long does fleet onboarding take?', a: 'Most fleets go live in 5–10 business days. Our white-glove team handles device configuration, custom location setup, and driver training. Larger enterprise deployments typically take 2–4 weeks with a dedicated project manager.' },
  { q: 'Is Trucker Path SOC2 certified?', a: 'Yes. Trucker Path is SOC2 compliant, ISO 27001 certified, and supports SSO and MDM (Mobile Device Management) for enterprise fleet deployments. Data security and cybersecurity are core to our platform.' },
];

const STATS = [
  { target: 11, suf: 'M+', label: 'Downloads', sub: 'And growing daily' },
  { target: 5,  suf: 'B+', label: 'Miles Routed', sub: 'Across North America' },
  { target: 100,suf: 'M+', label: 'Monthly Check-ins', sub: 'Truck stops, parking, weigh stations' },
  { target: 1,  suf: 'M+', label: 'Monthly Active Users', sub: 'Owner-ops and fleet drivers' },
];

function HeroCanvas() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf;
    let frame = 0;

    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    // Major US freight hub cities (normalized coords)
    const HUBS = [
      { id: 'SEA', nx: 0.09, ny: 0.11 },
      { id: 'LAX', nx: 0.10, ny: 0.62 },
      { id: 'PHX', nx: 0.20, ny: 0.68 },
      { id: 'DEN', nx: 0.29, ny: 0.41 },
      { id: 'DAL', nx: 0.40, ny: 0.68 },
      { id: 'HOU', nx: 0.45, ny: 0.78 },
      { id: 'CHI', nx: 0.57, ny: 0.27 },
      { id: 'ATL', nx: 0.60, ny: 0.62 },
      { id: 'MIA', nx: 0.66, ny: 0.83 },
      { id: 'NYC', nx: 0.77, ny: 0.21 },
    ];

    // Major freight corridors
    const ROUTES = [
      ['SEA', 'DEN'], ['SEA', 'LAX'],
      ['LAX', 'PHX'], ['LAX', 'DEN'],
      ['PHX', 'DAL'], ['PHX', 'DEN'],
      ['DEN', 'CHI'], ['DEN', 'DAL'],
      ['DAL', 'HOU'], ['DAL', 'ATL'], ['DAL', 'CHI'],
      ['HOU', 'ATL'], ['HOU', 'MIA'],
      ['CHI', 'NYC'], ['CHI', 'ATL'],
      ['ATL', 'NYC'], ['ATL', 'MIA'],
    ];

    // Bidirectional adjacency
    const adj = {};
    HUBS.forEach(h => { adj[h.id] = []; });
    ROUTES.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });

    const hp = (id) => {
      const h = HUBS.find(h => h.id === id);
      return h ? { x: h.nx * canvas.width, y: h.ny * canvas.height } : null;
    };

    const COLORS = ['#10B981', '#10B981', '#10B981', '#10B981', '#F59E0B', '#F59E0B', '#EF4444', '#10B981'];
    const trucks = COLORS.map((color) => {
      const r = ROUTES[Math.floor(Math.random() * ROUTES.length)];
      const [fromId, toId] = Math.random() > 0.5 ? [r[0], r[1]] : [r[1], r[0]];
      return { fromId, toId, progress: Math.random(), speed: 0.0015 + Math.random() * 0.002, color, trail: [] };
    });

    const pulseT = HUBS.map(() => Math.random() * Math.PI * 2);

    function draw() {
      frame++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Route glow + line
      ROUTES.forEach(([aId, bId]) => {
        const a = hp(aId), b = hp(bId);
        if (!a || !b) return;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = 'rgba(28,142,232,0.055)'; ctx.lineWidth = 4; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = 'rgba(28,142,232,0.18)'; ctx.lineWidth = 0.8; ctx.stroke();
      });

      // Moving data packets along routes
      ROUTES.forEach(([aId, bId], ri) => {
        const a = hp(aId), b = hp(bId);
        if (!a || !b) return;
        const t = ((frame * 0.006 + ri * 0.41) % 1);
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(28,142,232,0.6)'; ctx.fill();
      });

      // Trucks
      trucks.forEach(t => {
        t.progress += t.speed;
        if (t.progress >= 1) {
          t.progress = 0; t.trail = [];
          const nexts = (adj[t.toId] || []).filter(id => id !== t.fromId);
          const newTo = nexts.length ? nexts[Math.floor(Math.random() * nexts.length)] : t.fromId;
          t.fromId = t.toId; t.toId = newTo;
        }
        const from = hp(t.fromId), to = hp(t.toId);
        if (!from || !to) return;
        const x = from.x + (to.x - from.x) * t.progress;
        const y = from.y + (to.y - from.y) * t.progress;
        const angle = Math.atan2(to.y - from.y, to.x - from.x);

        t.trail.push({ x, y });
        if (t.trail.length > 24) t.trail.shift();

        if (t.trail.length > 2) {
          ctx.save(); ctx.globalAlpha = 0.32;
          ctx.beginPath();
          t.trail.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
          ctx.strokeStyle = t.color; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.stroke();
          ctx.restore();
        }

        ctx.save();
        ctx.translate(x, y); ctx.rotate(angle); ctx.globalAlpha = 0.88;
        ctx.fillStyle = t.color; ctx.fillRect(-10, -2, 11, 4);  // trailer
        ctx.fillStyle = t.color; ctx.fillRect(1, -2.5, 5.5, 5); // cab
        ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(-8, 2, 3, 1.5); ctx.fillRect(2, 2, 3, 1.5); // wheels
        ctx.restore();
      });

      // Hubs — pulse rings + dot + label
      HUBS.forEach((h, i) => {
        pulseT[i] += 0.016;
        const pulse = (Math.sin(pulseT[i]) + 1) / 2;
        const x = h.nx * canvas.width, y = h.ny * canvas.height;

        ctx.beginPath(); ctx.arc(x, y, 5 + pulse * 6.5, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(28,142,232,${0.04 + pulse * 0.15})`; ctx.lineWidth = 1; ctx.stroke();

        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#1C8EE8'; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();

        ctx.font = '600 7.5px "DM Sans", sans-serif';
        ctx.fillStyle = 'rgba(241,245,249,0.62)';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(h.id, x, y - 7);
      });

      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} id="heroMapC" style={{ width: '100%', height: '100%' }} />;
}

function StatCounter({ target, suf, label, sub, active }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active) return;
    const dur = 1800, start = performance.now();
    const r = requestAnimationFrame(function tick(now) {
      const t = Math.min((now - start) / dur, 1);
      const e = 1 - Math.pow(1 - t, 3);
      setVal(Math.floor(target * e));
      if (t < 1) requestAnimationFrame(tick); else setVal(target);
    });
    return () => cancelAnimationFrame(r);
  }, [active, target]);
  return (
    <div className="lp-stat-cell">
      <div className="lp-stat-num">{val}{suf}</div>
      <div className="lp-stat-label">{label}</div>
      <div className="lp-stat-sub">{sub}</div>
    </div>
  );
}

export default function Landing({ onShowView }) {
  const [scrolled, setScrolled] = useState(false);
  const [statsVisible, setStatsVisible] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);
  const [annual, setAnnual] = useState(true);
  const statsRef = useRef(null);
  const revealRefs = useRef([]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setStatsVisible(true); }, { threshold: 0.3 });
    if (statsRef.current) obs.observe(statsRef.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); });
    }, { threshold: 0.1 });
    revealRefs.current.forEach(el => el && obs.observe(el));
    return () => obs.disconnect();
  }, []);
  const rv = el => { if (el && !revealRefs.current.includes(el)) revealRefs.current.push(el); };

  return (
    <div>
      {/* NAV */}
      <nav id="lp-nav" className={scrolled ? 'scrolled' : ''}>
        <div className="lp-logo">
          <span style={{ width: 36, height: 36, minWidth: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 8, flexShrink: 0 }}>
            <TpLogo size={36} />
          </span>
          Trucker<span style={{ color: 'var(--blue-brand)' }}>Path</span>
        </div>
        <ul className="lp-nav-links">
          <li><a href="#products">Products</a></li>
          <li><a href="#fleet-nav">Fleet Navigation</a></li>
          <li><a href="#load-board">Load Board</a></li>
          <li><a href="#pricing">Pricing</a></li>
          <li><a href="#testimonials">Customers</a></li>
        </ul>
        <div className="lp-nav-actions">
          <button className="btn-nav-ghost" onClick={() => onShowView('chooser')}>Log In</button>
          <button className="btn-nav-cta" onClick={() => onShowView('chooser')}>Get Started Free →</button>
        </div>
      </nav>

      {/* HERO */}
      <section className="lp-hero">
        <div className="lp-hero-grid" />
        <div className="lp-hero-glow" />
        <div className="lp-hero-badge">
          <div className="lp-badge-dot" />
          Since 2013 · North America's #1 Trucking Platform
        </div>
        <h1 className="lp-hero-title">
          The <span className="hi">#1 Platform</span><br />
          for Truckers<br />
          <span style={{ color: 'rgba(241,245,249,0.3)' }}>and Fleets.</span>
        </h1>
        <p className="lp-hero-sub">
          North America's leader in truck driver safety, efficiency, and over-the-road comfort. GPS navigation, free load board, fuel prices, parking — all in one app.
        </p>
        <div className="lp-hero-actions">
          <button className="btn-hero-blue" onClick={() => onShowView('chooser')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
            Get Started Free
          </button>
          <button className="btn-hero-ghost" onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })}>
            ▶ Explore Products
          </button>
        </div>
        <div className="lp-hero-trust">
          <div className="trust-avs">
            <div className="trust-av" style={{ color: '#60A5FA' }}>BL</div>
            <div className="trust-av" style={{ color: '#34D399' }}>MR</div>
            <div className="trust-av" style={{ color: '#F59E0B' }}>KP</div>
            <div className="trust-av" style={{ color: '#A78BFA' }}>SA</div>
          </div>
          <div className="trust-stars">★★★★★</div>
          <span>Rated 4.8/5 by 300,000+ owner-operators</span>
          <span style={{ opacity: 0.3, margin: '0 6px' }}>|</span>
          <span>🛡️ SOC2 Certified · ISO 27001</span>
        </div>

        {/* Browser Mockup */}
        <div className="lp-hero-mockup">
          <div className="lp-mockup-shell">
            <div className="lp-mockup-bar">
              <div className="mc mc-r" /><div className="mc mc-y" /><div className="mc mc-g" />
              <div className="lp-mockup-url">app.qubiway.com — Fleet Command Center</div>
            </div>
            <div className="lp-mockup-body">
              <div className="lp-mock-sidebar">
                <div className="lp-mock-item act">🗺️&nbsp; Smart Dispatch</div>
                <div className="lp-mock-item">👥&nbsp; Drivers</div>
                <div className="lp-mock-item">🌐&nbsp; 3D Digital Twin</div>
                <div className="lp-mock-item">🔔&nbsp; Live Alerts</div>
                <div className="lp-mock-item">📋&nbsp; Billing Pipeline</div>
                <div className="lp-mock-item">📈&nbsp; Cost Intelligence</div>
              </div>
              <div className="lp-mock-main">
                <div className="lp-map-canvas-wrap">
                  <div className="lp-map-grid" />
                  <HeroCanvas />
                  <div style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(5,8,15,0.88)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 9, padding: '9px 13px', backdropFilter: 'blur(8px)' }}>
                    <div style={{ fontSize: 10, color: 'rgba(241,245,249,0.3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 1 }}>Fleet Map — Live</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5 }}><div style={{ width: 7, height: 7, background: '#10B981', borderRadius: '50%' }} /><span>Active</span><span style={{ marginLeft: 'auto', color: '#10B981', fontWeight: 700, paddingLeft: 8 }}>5</span></div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5 }}><div style={{ width: 7, height: 7, background: '#F59E0B', borderRadius: '50%' }} /><span>At Stop</span><span style={{ marginLeft: 'auto', color: '#F59E0B', fontWeight: 700, paddingLeft: 8 }}>2</span></div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5 }}><div style={{ width: 7, height: 7, background: '#EF4444', borderRadius: '50%' }} /><span>Alert</span><span style={{ marginLeft: 'auto', color: '#EF4444', fontWeight: 700, paddingLeft: 8 }}>1</span></div>
                    </div>
                  </div>
                  <div style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(5,8,15,0.85)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '7px 11px', fontSize: 10 }}>
                    <div style={{ color: 'rgba(241,245,249,0.35)', marginBottom: 2 }}>10 Hub Cities · 17 Corridors</div>
                    <div style={{ color: 'rgba(28,142,232,0.9)', fontWeight: 700 }}>● Live Freight Network</div>
                  </div>
                  <div style={{ position: 'absolute', bottom: 10, right: 10, background: 'rgba(5,8,15,0.88)', border: '1px solid rgba(28,142,232,0.2)', borderRadius: 9, padding: '9px 13px' }}>
                    <div style={{ fontSize: 10, color: 'rgba(241,245,249,0.3)', marginBottom: 3 }}>On-Time Rate</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, color: 'var(--blue-brand)' }}>98.2%</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TICKER */}
      <div className="lp-ticker-wrap" aria-hidden="true">
        <div className="lp-ticker-track">
          {['Free Load Board', 'Truck GPS Navigation', '500K+ Truck Stop POIs', 'Fleet Management', 'AI Load Matching', 'Fuel Price Finder', 'Real-Time Parking', 'Weigh Station Status', 'SOC2 Certified',
            'Free Load Board', 'Truck GPS Navigation', '500K+ Truck Stop POIs', 'Fleet Management', 'AI Load Matching', 'Fuel Price Finder', 'Real-Time Parking', 'Weigh Station Status', 'SOC2 Certified'].map((t, i) => (
            <span key={i} className="lp-ticker-item">{t}<span className="lp-ticker-sep"> ✦ </span></span>
          ))}
        </div>
      </div>

      {/* STATS */}
      <div className="lp-stats" ref={statsRef}>
        <div className="lp-stats-tag">Trusted by Professionals — Since Launching in 2013</div>
        <div className="lp-stats-grid">
          {STATS.map((s, i) => <StatCounter key={i} {...s} active={statsVisible} />)}
        </div>
      </div>

      {/* PRODUCTS */}
      <section className="lp-section" id="products" style={{ background: 'var(--bg)' }}>
        <div className="lp-s-tag lp-reveal" ref={rv}>All-in-One Platform</div>
        <h2 className="lp-s-title lp-reveal" ref={rv}>Solutions for the<br />Transportation Industry</h2>
        <p className="lp-s-sub lp-reveal" ref={rv} style={{ marginBottom: 0 }}>Three products, one ecosystem — built for every driver and fleet in North America.</p>
        <div className="lp-prod-grid">
          <div className="lp-prod-card lp-reveal" ref={rv} style={{ transitionDelay: '0s' }}>
            <div className="lp-prod-icon">🛣️</div>
            <div className="lp-prod-title">Trucker Path App</div>
            <div className="lp-prod-desc">The #1 app for North American truckers. Truck GPS & navigation, 500K+ POIs, real-time parking, weigh station status, and fuel prices — all in one app.</div>
            <div className="lp-prod-feats">
              <div className="lp-prod-feat">Truck GPS & customized routing</div>
              <div className="lp-prod-feat">Real-time traffic updates & restrictions</div>
              <div className="lp-prod-feat">500K+ truck stop POIs & parking availability</div>
              <div className="lp-prod-feat">Advanced trip planning & dock insights</div>
            </div>
            <div className="lp-prod-link" style={{ cursor: 'pointer' }} onClick={() => onShowView('chooser')}>Start Free Trial →</div>
          </div>
          <div className="lp-prod-card lp-reveal" id="fleet-nav" ref={rv} style={{ transitionDelay: '0.1s' }}>
            <div className="lp-prod-icon">🏢</div>
            <div className="lp-prod-title">Fleet Navigation</div>
            <div className="lp-prod-desc">Enterprise-grade commercial truck-safe navigation for fleets of 3+ trucks. Leading truck-safe navigation with white-glove service and enterprise security.</div>
            <div className="lp-prod-feats">
              <div className="lp-prod-feat">Commercial fleet navigation, low data usage</div>
              <div className="lp-prod-feat">Custom routes, locations & geofences</div>
              <div className="lp-prod-feat">White glove setup, integration & training</div>
              <div className="lp-prod-feat">SOC2 compliant, SSO supported, ISO 27001</div>
            </div>
            <div className="lp-prod-link" style={{ cursor: 'pointer' }} onClick={() => onShowView('chooser')}>Get a Demo →</div>
          </div>
          <div className="lp-prod-card lp-reveal" id="load-board" ref={rv} style={{ transitionDelay: '0.2s' }}>
            <div className="lp-prod-icon">📦</div>
            <div className="lp-prod-title">Trucking Load Board</div>
            <div className="lp-prod-desc">AI-ENHANCED premier free load board. Carriers get free unlimited access to 150,000+ loads daily. AI-powered matching connects owner-operators with shippers.</div>
            <div className="lp-prod-feats">
              <div className="lp-prod-feat">150,000+ loads available daily</div>
              <div className="lp-prod-feat">AI-powered load matching engine</div>
              <div className="lp-prod-feat">Free for carriers — no subscription</div>
              <div className="lp-prod-feat">Search online or via mobile app</div>
            </div>
            <div className="lp-prod-link" style={{ cursor: 'pointer' }} onClick={() => onShowView('chooser')}>Search Loads Free →</div>
          </div>
        </div>
      </section>

      {/* FLEET NAV FEATURE SPLIT */}
      <section className="lp-section" style={{ background: 'var(--bg2)' }}>
        <div className="lp-split">
          <div className="lp-reveal-l" ref={rv}>
            <div className="lp-s-tag">Enterprise Grade</div>
            <h2 className="lp-s-title">Commercial Truck-Safe<br />Navigation for Fleets</h2>
            <p className="lp-s-sub">Award-winning TMS that simplifies trucking operations with everything you need to manage your fleet.</p>
            <div className="lp-feat-list" style={{ marginBottom: 28 }}>
              {[
                { icon: '🗺️', title: 'Dispatch & Navigation', desc: 'Commercial fleet navigation with low data consumption, custom routes, and location management.' },
                { icon: '📦', title: 'Load Board Integration', desc: 'Connect with shippers, find loads, and manage dispatch all from the same platform.' },
                { icon: '📋', title: 'Doc Management', desc: 'Digital BOLs, PODs, and rate confirmations — paperless from day one.' },
                { icon: '⛽', title: 'Fuel Discounts & Controls', desc: 'Fuel discount programs, spend controls, and real-time price comparisons across 10,000+ stops.' },
              ].map((f, i) => (
                <div key={i} className="lp-feat-item">
                  <div className="lp-feat-icon">{f.icon}</div>
                  <div><div className="lp-feat-title">{f.title}</div><div className="lp-feat-desc">{f.desc}</div></div>
                </div>
              ))}
            </div>
            <button className="btn-hero-blue" onClick={() => onShowView('chooser')} style={{ fontSize: 14, padding: '13px 28px' }}>Get a Demo →</button>
          </div>
          <div className="lp-reveal-r" ref={rv}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 18, padding: 28, boxShadow: '0 24px 80px rgba(0,0,0,0.4)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
                {[{ v: 24, l: 'Active', c: '#10B981' }, { v: 6, l: 'At Stop', c: 'var(--amber)' }, { v: 3, l: 'Loading', c: 'var(--blue-brand)' }].map((s, i) => (
                  <div key={i} style={{ background: 'var(--bg2)', borderRadius: 10, padding: 14, textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: s.c }}>{s.v}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{s.l}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { id: 'TK-0471', name: 'Mike Johnson', route: 'I-10 W · Phoenix → Dallas', badge: '68 mph', bc: '#10B981' },
                  { id: 'TK-0392', name: 'Sara Lopez', route: 'Rest Stop · El Paso, TX', badge: 'PARKED', bc: 'var(--amber)' },
                  { id: 'TK-0215', name: 'Angela Davis', route: 'I-40 E · Dallas → Miami', badge: '65 mph', bc: '#10B981' },
                ].map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg2)', borderRadius: 9, padding: '11px 13px' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{d.id} — {d.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{d.route}</div>
                    </div>
                    <div style={{ background: d.bc + '1a', border: `1px solid ${d.bc}40`, color: d.bc, padding: '3px 9px', borderRadius: 5, fontSize: 10, fontWeight: 700 }}>{d.badge}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
                <div style={{ background: 'rgba(28,142,232,0.08)', border: '1px solid rgba(28,142,232,0.2)', borderRadius: 9, padding: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>On-Time Rate</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--blue-brand)' }}>98.2%</div>
                </div>
                <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 9, padding: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>Revenue Today</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: '#10B981' }}>$37.2K</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="lp-testi-section" id="testimonials">
        <div className="lp-testi-header">
          <div className="lp-s-tag lp-reveal" ref={rv}>Hear From Our Customers</div>
          <h2 className="lp-s-title lp-reveal" ref={rv}>Trusted by<br />300,000+ Professionals</h2>
        </div>
        {[
          [
            { av: 'BB', name: 'Brian L. Belvins', role: 'Owner-Operator, Army First Sergeant', q: '"As a retired Army First Sergeant, I tested multiple GPS platforms side by side. Trucker Path stood out — the accuracy, user-driven data, and practical routing made it the clear choice."' },
            { av: 'MR', name: 'Michael R.', role: 'Owner-Operator · Chicago, IL', q: '"As a former executive, planning has always been essential, not optional, and Trucker Path quickly became one of my core tools on the road. More than once, it saved me from bad decisions."' },
            { av: 'SK', name: 'Sarah K.', role: 'VP Operations · MidWest Freight Co.', q: '"We deployed Trucker Path Fleet Nav across 85 trucks in 3 weeks. The enterprise team handled everything. Our dispatchers saved 4 hours a day and driver complaints dropped 60%."' },
            { av: 'CM', name: 'Carlos M.', role: 'Independent Carrier · Dallas, TX', q: '"The AI load matching is genuinely smart. It surfaces loads I\'d never have searched for — and they pay better than my regular lanes. Booked $14,000 in extra revenue last month alone."' },
            { av: 'TP', name: 'Tony P.', role: 'Long-Haul Driver · Chicago, IL', q: '"After 11 years of trucking I\'ve tried every app. Nothing comes close. The weigh station alerts have saved me from violations twice. The community keeps the data incredibly accurate."' },
          ],
          [
            { av: 'LH', name: 'Linda H.', role: 'Fleet Manager · HorizonHaul Inc.', q: '"We went from 12% late deliveries to under 2% in six months. The route optimization accounts for restrictions our drivers didn\'t even know about. Zero low-bridge incidents since."' },
            { av: 'JM', name: 'James M.', role: 'Owner-Operator · 3 units', q: '"I use Trucker Path to fill my backhauls. What used to be 800 miles of deadhead is now consistently loaded. I\'ve increased my monthly gross by $8,000 since I started using it."' },
            { av: 'DM', name: 'Daniel M.', role: 'Director Ops · PharmaCore LLC', q: '"When our cold chain had a hiccup at 2 AM, their team responded in 8 minutes. Temperature never dropped. That\'s the kind of platform you want for pharmaceutical loads."' },
            { av: 'AT', name: 'Alex T.', role: 'CTO · National Carriers Inc.', q: '"The enterprise SSO integration took one afternoon. Our IT team was shocked — they expected a two-week project. The MDM rollout to 200 devices was completely automated."' },
          ],
        ].map((row, ri) => (
          <div key={ri} className="lp-marquee-wrap" style={ri > 0 ? {} : { marginBottom: 18 }}>
            <div className={`lp-marquee-track${ri > 0 ? ' rev' : ''}`}>
              {[...row, ...row].map((t, i) => (
                <div key={i} className="lp-testi-card">
                  <div className="lp-testi-stars">★★★★★</div>
                  <p className="lp-testi-quote">{t.q}</p>
                  <div className="lp-testi-author">
                    <div className="lp-testi-av">{t.av}</div>
                    <div><div className="lp-testi-name">{t.name}</div><div className="lp-testi-role">{t.role}</div></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* PRICING */}
      <section className="lp-section" id="pricing" style={{ background: 'var(--bg3)' }}>
        <div className="lp-s-tag lp-reveal" ref={rv}>Transparent Pricing</div>
        <h2 className="lp-s-title lp-reveal" ref={rv}>Simple, Transparent Pricing</h2>
        <p className="lp-s-sub lp-reveal" ref={rv}>No hidden fees. No long-term contracts. Start free and scale as your fleet grows.</p>

        {/* Billing toggle */}
        <div className="lp-billing-toggle lp-reveal" ref={rv}>
          <button className={`lp-billing-btn${!annual ? ' active' : ''}`} onClick={() => setAnnual(false)}>Monthly</button>
          <button className={`lp-billing-btn${annual ? ' active' : ''}`} onClick={() => setAnnual(true)}>
            Annual <span className="lp-save-badge">Save 17%</span>
          </button>
        </div>

        <div className="lp-price-grid">

          {/* Plan 1 — Driver (Free) */}
          <div className="lp-price-card lp-reveal" ref={rv} style={{ transitionDelay: '0s' }}>
            <div className="lp-plan-name">Driver App</div>
            <div className="lp-plan-price"><span className="cur">$</span>0</div>
            <div className="lp-plan-period">Free forever</div>
            <div className="lp-plan-audience">For individual truckers &amp; owner-ops</div>
            <div className="lp-plan-desc">GPS navigation, load board access, and 500K+ truck stop POIs — everything you need on the road, at no cost.</div>
            <div className="lp-plan-feats">
              <div className="lp-pf">Truck GPS &amp; navigation</div>
              <div className="lp-pf">500K+ truck stop POIs</div>
              <div className="lp-pf">Real-time parking availability</div>
              <div className="lp-pf">Weigh station status</div>
              <div className="lp-pf">Fuel price comparison</div>
              <div className="lp-pf">Free load board access</div>
              <div className="lp-pf na">Fleet management dashboard</div>
              <div className="lp-pf na">Dispatch &amp; driver tracking</div>
              <div className="lp-pf na">Billing &amp; invoicing</div>
            </div>
            <button className="btn-plan-ghost" onClick={() => onShowView('user-login')}>Get Started Free →</button>
          </div>

          {/* Plan 2 — Fleet Pro (featured) */}
          <div className="lp-price-card featured lp-reveal" ref={rv} style={{ transitionDelay: '0.1s' }}>
            <div className="lp-plan-name">Fleet Pro</div>
            <div className="lp-plan-price">
              <span className="cur">$</span>{annual ? 49 : 59}
              {!annual && <span className="lp-price-was"> save $120/yr with annual</span>}
            </div>
            <div className="lp-plan-period">per truck / month{annual ? ', billed annually' : ', billed monthly'}</div>
            <div className="lp-plan-audience">For fleets with 3–50 trucks · 30-day free trial</div>
            <div className="lp-plan-desc">Full fleet OS — dispatch, real-time tracking, AI load optimization, billing pipeline, and white-glove onboarding.</div>
            <div className="lp-plan-feats">
              <div className="lp-pf">Everything in Driver App</div>
              <div className="lp-pf">Smart dispatch board</div>
              <div className="lp-pf">Real-time driver &amp; load tracking</div>
              <div className="lp-pf">Custom routes &amp; geofences</div>
              <div className="lp-pf">Billing pipeline &amp; invoicing</div>
              <div className="lp-pf">AI load matching &amp; optimization</div>
              <div className="lp-pf">Cost intelligence dashboard</div>
              <div className="lp-pf">Live alerts &amp; HOS monitoring</div>
              <div className="lp-pf">White glove setup &amp; training</div>
            </div>
            <button className="btn-plan-blue" onClick={() => onShowView('admin-login')}>Start Free Trial →</button>
          </div>

          {/* Plan 3 — Enterprise */}
          <div className="lp-price-card lp-reveal" ref={rv} style={{ transitionDelay: '0.2s' }}>
            <div className="lp-plan-name">Enterprise</div>
            <div className="lp-plan-price lp-plan-price-custom">Custom</div>
            <div className="lp-plan-period">Volume pricing · Custom contract</div>
            <div className="lp-plan-audience">For fleets of 50+ trucks</div>
            <div className="lp-plan-desc">Enterprise-grade security, dedicated account management, custom integrations, and guaranteed SLAs at any scale.</div>
            <div className="lp-plan-feats">
              <div className="lp-pf">Everything in Fleet Pro</div>
              <div className="lp-pf">Dedicated account manager</div>
              <div className="lp-pf">Custom API integrations</div>
              <div className="lp-pf">SOC2 · SSO · ISO 27001 · MDM</div>
              <div className="lp-pf">99.9% uptime SLA</div>
              <div className="lp-pf">Custom contract &amp; billing</div>
              <div className="lp-pf">On-site training &amp; deployment</div>
              <div className="lp-pf">24/7 priority support line</div>
              <div className="lp-pf">Unlimited trucks</div>
            </div>
            <button className="btn-plan-ghost" onClick={() => onShowView('admin-login')}>Contact Sales →</button>
          </div>

        </div>

        <div className="lp-pricing-note">
          All paid plans include a 30-day free trial · No credit card required · Cancel anytime
        </div>
      </section>

      {/* FAQ */}
      <section className="lp-section" style={{ background: 'var(--bg)' }}>
        <div className="lp-s-tag lp-reveal" ref={rv}>Questions</div>
        <h2 className="lp-s-title lp-reveal" ref={rv} style={{ marginBottom: 36 }}>Frequently Asked<br />Questions</h2>
        <div className="lp-faq-grid">
          {FAQS.map((f, i) => (
            <div key={i} className={`lp-faq-item${openFaq === i ? ' open' : ''}`}>
              <div className="lp-faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                {f.q} <span className="lp-faq-arrow">{openFaq === i ? '×' : '+'}</span>
              </div>
              <div className="lp-faq-a">{f.a}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="lp-cta-section">
        <h2 className="lp-cta-title">Ready to Move<br />More Freight?</h2>
        <p className="lp-cta-sub">Join 11 million drivers and fleets across North America. Start for free — scale when you're ready.</p>
        <button className="btn-cta-white" onClick={() => onShowView('chooser')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
          Get Started Free
        </button>
        <p className="lp-cta-note">No credit card required · No contracts · Cancel anytime</p>
      </section>

      {/* FOOTER */}
      <footer className="lp-footer">
        <div className="lp-footer-grid">
          <div className="lp-footer-brand">
            <div className="lp-logo">
              <span style={{ width: 36, height: 36, minWidth: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 8, flexShrink: 0 }}>
                <TpLogo size={36} />
              </span>
              Trucker<span style={{ color: 'var(--blue-brand)' }}>Path</span>
            </div>
            <p>North America's #1 platform for truckers and fleets. GPS navigation, AI load board, real-time tracking, and fleet intelligence — one ecosystem, 11 million drivers.</p>
            <div className="lp-app-badges">
              <div className="lp-app-badge">📱<div><span className="lp-app-store">Download on</span><span className="lp-app-name">App Store</span></div></div>
              <div className="lp-app-badge">🤖<div><span className="lp-app-store">Get it on</span><span className="lp-app-name">Google Play</span></div></div>
            </div>
          </div>
          <div className="lp-footer-col">
            <h4>Products</h4>
            <ul>
              <li><a>Trucker Path App</a></li>
              <li><a>Fleet Navigation</a></li>
              <li><a>Load Board</a></li>
              <li><a>Pricing</a></li>
            </ul>
          </div>
          <div className="lp-footer-col">
            <h4>Company</h4>
            <ul>
              <li><a>About Us</a></li>
              <li><a>Blog & News</a></li>
              <li><a>Careers</a></li>
              <li><a>Contact</a></li>
            </ul>
          </div>
          <div className="lp-footer-col">
            <h4>Legal</h4>
            <ul>
              <li><a>Privacy Policy</a></li>
              <li><a>Terms of Service</a></li>
              <li><a>Security</a></li>
              <li><a>Help Center</a></li>
            </ul>
          </div>
        </div>
        <div className="lp-footer-bottom">
          <div className="lp-footer-copy">© 2024 Qubiway, Inc.<span className="lp-footer-dot">·</span>All rights reserved<span className="lp-footer-dot">·</span><span style={{ color: 'var(--blue-brand)' }}>qubiway.com</span></div>
          <div className="lp-footer-socials">
            <div className="lp-social-btn">𝕏</div>
            <div className="lp-social-btn">in</div>
            <div className="lp-social-btn">f</div>
            <div className="lp-social-btn">▶</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
