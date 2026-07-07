import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const LIGHT = {
  bg: "#F6F8FA",
  card: "#FFFFFF",
  ink: "#1A2330",
  muted: "#5A6B7E",
  line: "#D9E2EC",
  navy: "#1F4E78",
  navyDeep: "#16395C",
  red: "#C8102E",
  green: "#1E7B4F",
  amber: "#B7791F",
  hilite: "#EAF1F8",
};

const DARK = {
  bg: "#101820",
  card: "#172331",
  ink: "#EAF1F8",
  muted: "#A8B8C8",
  line: "#304253",
  navy: "#7FB3E6",
  navyDeep: "#D7EAFF",
  red: "#FF6B7E",
  green: "#54C58A",
  amber: "#F2B957",
  hilite: "#21344A",
};

const SCENARIO_LABELS = { C: "Conservative", R: "Realistic", A: "Aggressive" };

const SERVICE_LABELS = {
  er: "Emergency (ER)",
  obs: "Inpatient Observation",
  opd: "OPD General",
  wound: "Specialty Clinic",
  ped: "Pediatric",
};

const DEFAULT_BASE = {
  catchmentDemand: 45000,
  obsPoolBase: 400,
  pedY3Base: 3000,
  specialtyEligibleRate: 0.45,
  specialtyBaseVisits: 200,
  admitRate: 0.2,
  admitValue: 12000,
  groupCapture: 0.75,
  pedDownstreamMax: 5,
  laborBase: 25,
  utilBase: 6,
  itY3Base: 2,
  staffBaselineFte: 20,
  mkt: [3, 1.5, 1],
  fee: [0, 0.015, 0.03],
};

const DEFAULT_FACILITY = {
  erBays: 4,
  razChairs: 3,
  obsBeds: 2,
  opdRooms: 1,
  pedRooms: 1,
  procRooms: 1,
};

const DEFAULT_TIERS = {
  capture: { C: [0.05, 0.1, 0.15], R: [0.1, 0.18, 0.25], A: [0.15, 0.25, 0.35] },
  obsCap: { C: 0.4, R: 0.55, A: 0.7 },
  opdRatio: { C: 0.25, R: 0.35, A: 0.45 },
  specialtyMult: { C: 2, R: 3, A: 4 },
  pedFactor: { C: 0.8, R: 1, A: 1.2 },
};

const ACUITY_DEFAULT = [
  { label: "Tier 1", mix: 3, rev: 35000 },
  { label: "Tier 2", mix: 15, rev: 9000 },
  { label: "Tier 3", mix: 50, rev: 6000 },
  { label: "Tier 4", mix: 25, rev: 3200 },
  { label: "Tier 5", mix: 7, rev: 2500 },
];

const DEFAULT_SVC_REV = { obs: 25000, opd: 2800, wound: 3000, ped: 4000 };
const DEFAULT_MARGIN = { er: 50, obs: 50, opd: 50, wound: 50, ped: 50 };
const DEFAULT_SCEN = { er: "R", obs: "R", opd: "R", wound: "R", ped: "R" };

const CAPACITY_ROW_META = [
  { key: "erHoriz", label: "ER horizontal", supply: "Resus + trauma bays", unitName: "bays", facilityKey: "erBays", capPerUnit: 24 / 4, staffHours: 1.4, staffDays: 365 },
  { key: "raz", label: "RAZ recliner", supply: "Vertical / low acuity", unitName: "chairs", facilityKey: "razChairs", capPerUnit: 18 / 0.75, staffHours: 0.45, staffDays: 365 },
  { key: "obs", label: "Observation", supply: "≤24 hr stay", unitName: "beds", facilityKey: "obsBeds", capPerUnit: 24 / 16.5, staffHours: 4, staffDays: 365 },
  { key: "ped", label: "Pediatric OPD", supply: "clinic room", unitName: "rooms", facilityKey: "pedRooms", capPerUnit: 9 / 0.33, staffHours: 0.5, staffDays: 312 },
  { key: "wound", label: "Specialty Clinic", supply: "procedure room", unitName: "rooms", facilityKey: "procRooms", capPerUnit: 9 / 0.42, staffHours: 0.6, staffDays: 312 },
  { key: "opd", label: "OPD General", supply: "clinic room", unitName: "rooms", facilityKey: "opdRooms", capPerUnit: 9 / 0.33, staffHours: 0.45, staffDays: 312 },
];

function scenarioHint(key, tier, tiers) {
  if (key === "er") return `capture ${(tiers.capture[tier][2] * 100).toFixed(0)}%`;
  if (key === "obs") return `${(tiers.obsCap[tier] * 100).toFixed(0)}% pool`;
  if (key === "opd") return `${tiers.opdRatio[tier].toFixed(2)}x ER`;
  if (key === "wound") return `x${tiers.specialtyMult[tier]} FU`;
  if (key === "ped") {
    const f = tiers.pedFactor[tier];
    if (f === 1) return "base";
    return `${f > 1 ? "+" : ""}${Math.round((f - 1) * 100)}%`;
  }
  return "";
}

function computeModel({ scen, growth, rent, capex, infl, margin, esi, svcRev, base, tiers }) {
  const catchment = base.catchmentDemand;
  const mix = esi.reduce((s, x) => s + x.mix, 0) || 1;
  const erRev = esi.reduce((s, x) => s + (x.mix / mix) * x.rev, 0);
  const years = [];
  let cumS = -capex;
  let cumG = -capex;
  let payS = null;
  let payG = null;
  let minG = cumG;

  for (let y = 1; y <= 10; y += 1) {
    const cap3 = tiers.capture[scen.er][2];
    const cap = y <= 3 ? tiers.capture[scen.er][y - 1] : y === 4 ? cap3 + 0.05 : cap3 + 0.1;
    const grow = Math.pow(1 + growth, y);
    const er = catchment * grow * cap;
    const obs = base.obsPoolBase * tiers.obsCap[scen.obs] * Math.pow(1 + growth, y - 1);
    const opd = er * tiers.opdRatio[scen.opd];
    const wound = er * base.specialtyEligibleRate * 0.35 * tiers.specialtyMult[scen.wound] + base.specialtyBaseVisits * grow;
    const pedBase = base.pedY3Base * tiers.pedFactor[scen.ped];
    const ped = y <= 3 ? pedBase * Math.min(cap / cap3, 1) : pedBase * Math.pow(1 + growth, y - 3);
    const revER = (er * erRev) / 1e6;
    const revObs = (obs * svcRev.obs) / 1e6;
    const revOPD = (opd * svcRev.opd) / 1e6;
    const revWound = (wound * svcRev.wound) / 1e6;
    const revPed = (ped * svcRev.ped) / 1e6;
    const spokeRev = revER + revObs + revOPD + revWound + revPed;
    const downstream = (er * base.admitRate * base.admitValue * base.groupCapture) / 1e6 + base.pedDownstreamMax * Math.min(ped / base.pedY3Base, 1.5);
    const inf = Math.pow(1 + infl, y - 1);
    const laborStep = (y >= 4 ? (er / 365 > 40 ? 9 : er / 365 > 30 ? 4.5 : 0) : 0) * inf;
    const variable =
      revER * (1 - margin.er / 100) +
      revObs * (1 - margin.obs / 100) +
      revOPD * (1 - margin.opd / 100) +
      revWound * (1 - margin.wound / 100) +
      revPed * (1 - margin.ped / 100);
    const opex =
      base.laborBase * inf +
      laborStep +
      variable +
      base.utilBase * inf +
      (y <= 2 ? 0 : base.itY3Base * inf) +
      base.mkt[Math.min(y - 1, 2)] +
      base.fee[Math.min(y - 1, 2)] * spokeRev +
      (rent * 12) / 1e6;
    const netS = spokeRev - opex;
    const netG = netS + downstream;
    const prevS = cumS;
    const prevG = cumG;
    cumS += netS;
    cumG += netG;
    if (payS == null && cumS >= 0) payS = y - 1 + (0 - prevS) / netS;
    if (payG == null && cumG >= 0) payG = y - 1 + (0 - prevG) / netG;
    minG = Math.min(minG, cumG);
    years.push({ year: `Y${y}`, er, obs, opd, wound, ped, revER, revObs, revOPD, revWound, revPed, spokeRev, downstream, opex, netS, netG, cumS, cumG });
  }

  return { years, erRev, payS, payG, minG };
}

const fmtM = (v) => `${v >= 0 ? "" : "-"}${Math.abs(v).toFixed(1)}M`;
const fmtY = (v) => (v == null ? ">Y10" : `Y${v.toFixed(1)}`);

function Panel({ C, children, accent }) {
  return <section className="rounded-lg p-4 mb-4" style={{ background: C.card, border: `${accent ? 2 : 1}px solid ${accent || C.line}` }}>{children}</section>;
}

function Slider({ C, label, value, set, min, max, step, format }) {
  return (
    <label className="block mb-4 text-sm">
      <span className="flex justify-between mb-1"><span>{label}</span><b style={{ color: C.navy }}>{format(value)}</b></span>
      <input className="w-full" type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} style={{ accentColor: C.navy }} />
    </label>
  );
}

function Card({ C, label, value, sub, accent }) {
  return (
    <div className="flex-1 min-w-0 rounded-lg p-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
      <div className="text-xs uppercase tracking-wider mb-1" style={{ color: C.muted }}>{label}</div>
      <div className="text-2xl font-bold tabular-nums" style={{ color: accent || C.ink }}>{value}</div>
      <div className="text-xs mt-1" style={{ color: C.muted }}>{sub}</div>
    </div>
  );
}

function NumInput({ C, value, onChange, step = 1, min = 0, width = 20 }) {
  return (
    <input
      className="px-1.5 py-0.5 rounded border text-right tabular-nums"
      type="number"
      value={value}
      step={step}
      min={min}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      style={{ borderColor: C.line, background: C.card, color: C.ink, width: `${width * 0.25}rem` }}
    />
  );
}

const WIZARD_STEPS = ["Project & demand", "Facility design", "Cost & capital"];

export default function NewHospitalApp() {
  const [dark, setDark] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(() => (typeof window === "undefined" ? false : window.sessionStorage.getItem("new-hospital-auth") === "ok"));
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");

  const [stage, setStage] = useState("setup");
  const [wizardStep, setWizardStep] = useState(0);

  const [projectName, setProjectName] = useState("New Hospital Project");
  const [location, setLocation] = useState("");
  const [base, setBase] = useState(DEFAULT_BASE);
  const [facility, setFacility] = useState(DEFAULT_FACILITY);
  const [tiers, setTiers] = useState(DEFAULT_TIERS);
  const [capexParts, setCapexParts] = useState({ construction: 50, equipment: 18, it: 5 });
  const [rent, setRent] = useState(150000);
  const [growth, setGrowth] = useState(0.04);
  const [infl, setInfl] = useState(0.03);

  const [scen, setScen] = useState(DEFAULT_SCEN);
  const [view, setView] = useState("G");
  const [margin, setMargin] = useState(DEFAULT_MARGIN);
  const [esi, setEsi] = useState(ACUITY_DEFAULT);
  const [svcRev, setSvcRev] = useState(DEFAULT_SVC_REV);

  const C = dark ? DARK : LIGHT;
  const capex = capexParts.construction + capexParts.equipment + capexParts.it;

  const setBaseField = (key, value) => setBase({ ...base, [key]: value });
  const setMktField = (i, value) => setBase({ ...base, mkt: base.mkt.map((v, idx) => (idx === i ? value : v)) });
  const setFeeField = (i, value) => setBase({ ...base, fee: base.fee.map((v, idx) => (idx === i ? value : v)) });
  const setFacilityField = (key, value) => setFacility({ ...facility, [key]: value });
  const setTiersCaptureField = (tier, yearIdx, value) => setTiers({ ...tiers, capture: { ...tiers.capture, [tier]: tiers.capture[tier].map((v, idx) => (idx === yearIdx ? value : v)) } });
  const setTiersScalarField = (group, tier, value) => setTiers({ ...tiers, [group]: { ...tiers[group], [tier]: value } });

  const submitLogin = (event) => {
    event.preventDefault();
    if (loginUser.trim() === "BPK" && loginPass === "B1719") {
      window.sessionStorage.setItem("new-hospital-auth", "ok");
      setIsUnlocked(true);
      setLoginError("");
      return;
    }
    setLoginError("Invalid user or password");
  };

  if (!isUnlocked) {
    return (
      <main className="min-h-screen flex items-center" style={{ background: C.bg, color: C.ink, fontFamily: "system-ui, -apple-system, sans-serif", justifyContent: "center", padding: 24 }}>
        <form onSubmit={submitLogin} className="rounded-lg p-4" style={{ width: "min(420px, 100%)", background: C.card, border: `1px solid ${C.line}` }}>
          <div className="text-xs uppercase tracking-widest mb-1" style={{ color: C.red }}>New Hospital Feasibility</div>
          <h1 className="text-xl font-bold m-0" style={{ color: C.navyDeep }}>Dashboard access</h1>
          <div className="text-xs mt-1 mb-4" style={{ color: C.muted }}>Enter authorized user and password to continue.</div>

          <label className="block mb-3 text-sm">
            <span className="block mb-1" style={{ color: C.muted }}>User</span>
            <input className="w-full px-2 py-2 rounded border" value={loginUser} onChange={(event) => setLoginUser(event.target.value)} autoComplete="username" style={{ borderColor: C.line, background: C.bg, color: C.ink }} />
          </label>
          <label className="block mb-3 text-sm">
            <span className="block mb-1" style={{ color: C.muted }}>Password</span>
            <input className="w-full px-2 py-2 rounded border" type="password" value={loginPass} onChange={(event) => setLoginPass(event.target.value)} autoComplete="current-password" style={{ borderColor: C.line, background: C.bg, color: C.ink }} />
          </label>
          {loginError && <div className="text-xs mb-3 font-bold" style={{ color: C.red }}>{loginError}</div>}
          <button className="w-full px-3 py-2 rounded text-sm font-bold" type="submit" style={{ background: C.navy, color: "#fff", border: `1px solid ${C.navy}` }}>Enter dashboard</button>
        </form>
      </main>
    );
  }

  const header = (
    <header className="mb-5 pb-4" style={{ borderBottom: `3px solid ${C.navy}` }}>
      <div className="flex justify-between items-center gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest mb-1" style={{ color: C.red }}>New Hospital Feasibility Tool</div>
          <h1 className="text-xl md:text-2xl font-bold m-0" style={{ color: C.navyDeep }}>{projectName || "New Hospital Project"}</h1>
          <div className="text-xs mt-1" style={{ color: C.muted }}>{location ? `${location} · ` : ""}Define your own scenario, then explore payback, revenue, and capacity.</div>
        </div>
        <div className="flex gap-2">
          {stage === "dashboard" && (
            <button className="px-3 py-1 rounded text-xs font-bold" onClick={() => { setWizardStep(0); setStage("setup"); }} style={{ background: C.hilite, color: C.navy, border: `1px solid ${C.line}` }}>Edit setup</button>
          )}
          <button className="px-3 py-1 rounded text-xs font-bold" onClick={() => setDark(!dark)} style={{ background: C.hilite, color: C.navy, border: `1px solid ${C.line}` }}>{dark ? "Day mode" : "Night mode"}</button>
        </div>
      </div>
    </header>
  );

  if (stage === "setup") {
    return (
      <main className="min-h-screen p-4 md:p-6" style={{ background: C.bg, color: C.ink, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        {header}
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div className="flex gap-2 mb-4">
            {WIZARD_STEPS.map((label, i) => (
              <div key={label} className="flex-1 rounded-lg p-2 text-center text-xs font-bold" style={{ background: i === wizardStep ? C.navy : C.hilite, color: i === wizardStep ? "#fff" : C.navy, border: `1px solid ${C.line}` }}>
                {i + 1}. {label}
              </div>
            ))}
          </div>

          {wizardStep === 0 && (
            <Panel C={C}>
              <b style={{ color: C.navyDeep }}>1 · Project & demand</b>
              <div className="text-xs mt-1 mb-3" style={{ color: C.muted }}>Describe the project and the demand pool it will draw from.</div>
              <label className="block mb-4 text-sm">
                <span className="block mb-1" style={{ color: C.muted }}>Hospital / project name</span>
                <input className="w-full px-2 py-2 rounded border" value={projectName} onChange={(e) => setProjectName(e.target.value)} style={{ borderColor: C.line, background: C.card, color: C.ink }} />
              </label>
              <label className="block mb-4 text-sm">
                <span className="block mb-1" style={{ color: C.muted }}>Location / notes (optional)</span>
                <input className="w-full px-2 py-2 rounded border" value={location} onChange={(e) => setLocation(e.target.value)} style={{ borderColor: C.line, background: C.card, color: C.ink }} />
              </label>
              <Slider C={C} label="Annual catchment ED-eligible demand" value={base.catchmentDemand} set={(v) => setBaseField("catchmentDemand", v)} min={5000} max={150000} step={500} format={(v) => `${v.toLocaleString()} visits/yr`} />
              <Slider C={C} label="Baseline observation-eligible pool" value={base.obsPoolBase} set={(v) => setBaseField("obsPoolBase", v)} min={50} max={2000} step={10} format={(v) => `${v.toLocaleString()} cases/yr`} />
              <Slider C={C} label="Baseline Y3 pediatric demand" value={base.pedY3Base} set={(v) => setBaseField("pedY3Base", v)} min={0} max={10000} step={100} format={(v) => `${v.toLocaleString()} visits/yr`} />
              <Slider C={C} label="Specialty-eligible visit rate" value={base.specialtyEligibleRate} set={(v) => setBaseField("specialtyEligibleRate", v)} min={0} max={1} step={0.01} format={(v) => `${(v * 100).toFixed(0)}%`} />
              <Slider C={C} label="ER downstream admission rate" value={base.admitRate} set={(v) => setBaseField("admitRate", v)} min={0} max={0.5} step={0.01} format={(v) => `${(v * 100).toFixed(0)}%`} />
            </Panel>
          )}

          {wizardStep === 1 && (
            <Panel C={C}>
              <b style={{ color: C.navyDeep }}>2 · Facility design</b>
              <div className="text-xs mt-1 mb-3" style={{ color: C.muted }}>How many bays, chairs, beds, and rooms will the facility have? You can fine-tune these later on the dashboard too.</div>
              <Slider C={C} label="ER bays (Resus + trauma)" value={facility.erBays} set={(v) => setFacilityField("erBays", v)} min={1} max={20} step={1} format={(v) => `${v} bays`} />
              <Slider C={C} label="RAZ recliner chairs" value={facility.razChairs} set={(v) => setFacilityField("razChairs", v)} min={0} max={20} step={1} format={(v) => `${v} chairs`} />
              <Slider C={C} label="Observation beds" value={facility.obsBeds} set={(v) => setFacilityField("obsBeds", v)} min={0} max={20} step={1} format={(v) => `${v} beds`} />
              <Slider C={C} label="OPD General rooms" value={facility.opdRooms} set={(v) => setFacilityField("opdRooms", v)} min={0} max={10} step={1} format={(v) => `${v} rooms`} />
              <Slider C={C} label="Pediatric OPD rooms" value={facility.pedRooms} set={(v) => setFacilityField("pedRooms", v)} min={0} max={10} step={1} format={(v) => `${v} rooms`} />
              <Slider C={C} label="Specialty / procedure rooms" value={facility.procRooms} set={(v) => setFacilityField("procRooms", v)} min={0} max={10} step={1} format={(v) => `${v} rooms`} />
              <Slider C={C} label="Baseline staffed FTE" value={base.staffBaselineFte} set={(v) => setBaseField("staffBaselineFte", v)} min={5} max={100} step={1} format={(v) => `${v} FTE`} />
            </Panel>
          )}

          {wizardStep === 2 && (
            <Panel C={C}>
              <b style={{ color: C.navyDeep }}>3 · Cost & capital</b>
              <div className="text-xs mt-1 mb-3" style={{ color: C.muted }}>Fixed cost base, downstream value, capital spend, and macro assumptions.</div>
              <Slider C={C} label="Baseline labor cost /yr" value={base.laborBase} set={(v) => setBaseField("laborBase", v)} min={5} max={100} step={0.5} format={(v) => `${v}M`} />
              <Slider C={C} label="Baseline utilities cost /yr" value={base.utilBase} set={(v) => setBaseField("utilBase", v)} min={1} max={30} step={0.5} format={(v) => `${v}M`} />
              <Slider C={C} label="IT cost /yr (from Y3)" value={base.itY3Base} set={(v) => setBaseField("itY3Base", v)} min={0} max={15} step={0.5} format={(v) => `${v}M`} />
              <Slider C={C} label="Marketing Y1" value={base.mkt[0]} set={(v) => setMktField(0, v)} min={0} max={10} step={0.1} format={(v) => `${v}M`} />
              <Slider C={C} label="Marketing Y2" value={base.mkt[1]} set={(v) => setMktField(1, v)} min={0} max={10} step={0.1} format={(v) => `${v}M`} />
              <Slider C={C} label="Marketing Y3" value={base.mkt[2]} set={(v) => setMktField(2, v)} min={0} max={10} step={0.1} format={(v) => `${v}M`} />
              <Slider C={C} label="Variable fee Y3 (% of revenue)" value={base.fee[2]} set={(v) => setFeeField(2, v)} min={0} max={0.1} step={0.001} format={(v) => `${(v * 100).toFixed(1)}%`} />
              <Slider C={C} label="Downstream value / admission" value={base.admitValue} set={(v) => setBaseField("admitValue", v)} min={0} max={40000} step={500} format={(v) => `฿${v.toLocaleString()}`} />
              <Slider C={C} label="Group capture of downstream value" value={base.groupCapture} set={(v) => setBaseField("groupCapture", v)} min={0} max={1} step={0.05} format={(v) => `${(v * 100).toFixed(0)}%`} />
              <Slider C={C} label="Pediatric downstream value cap" value={base.pedDownstreamMax} set={(v) => setBaseField("pedDownstreamMax", v)} min={0} max={20} step={0.5} format={(v) => `${v}M/yr`} />
              <Slider C={C} label="CapEx · Construction" value={capexParts.construction} set={(v) => setCapexParts({ ...capexParts, construction: v })} min={5} max={200} step={1} format={(v) => `${v}M`} />
              <Slider C={C} label="CapEx · Med equipment" value={capexParts.equipment} set={(v) => setCapexParts({ ...capexParts, equipment: v })} min={1} max={100} step={1} format={(v) => `${v}M`} />
              <Slider C={C} label="CapEx · IT" value={capexParts.it} set={(v) => setCapexParts({ ...capexParts, it: v })} min={0} max={30} step={1} format={(v) => `${v}M`} />
              <div className="text-xs mb-4" style={{ color: C.muted }}>Total CapEx = {capex.toFixed(0)}M</div>
              <Slider C={C} label="Rent THB/month" value={rent} set={setRent} min={0} max={1000000} step={5000} format={(v) => `${(v / 1000).toFixed(0)}K`} />
              <Slider C={C} label="Demand growth /yr" value={growth} set={setGrowth} min={0} max={0.1} step={0.005} format={(v) => `${(v * 100).toFixed(1)}%`} />
              <Slider C={C} label="OpEx inflation /yr" value={infl} set={setInfl} min={0} max={0.08} step={0.005} format={(v) => `${(v * 100).toFixed(1)}%`} />
            </Panel>
          )}

          <div className="flex justify-between gap-2 mb-8">
            <button
              className="px-4 py-2 rounded text-sm font-bold"
              onClick={() => setWizardStep(Math.max(0, wizardStep - 1))}
              disabled={wizardStep === 0}
              style={{ background: C.hilite, color: C.navy, border: `1px solid ${C.line}`, opacity: wizardStep === 0 ? 0.5 : 1 }}
            >
              &larr; Back
            </button>
            {wizardStep < WIZARD_STEPS.length - 1 ? (
              <button className="px-4 py-2 rounded text-sm font-bold" onClick={() => setWizardStep(wizardStep + 1)} style={{ background: C.navy, color: "#fff", border: `1px solid ${C.navy}` }}>Next &rarr;</button>
            ) : (
              <button className="px-4 py-2 rounded text-sm font-bold" onClick={() => setStage("dashboard")} style={{ background: C.green, color: "#fff", border: `1px solid ${C.green}` }}>Launch feasibility dashboard</button>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <DashboardStage
      C={C}
      header={header}
      scen={scen}
      setScen={setScen}
      growth={growth}
      setGrowth={setGrowth}
      infl={infl}
      setInfl={setInfl}
      capexParts={capexParts}
      setCapexParts={setCapexParts}
      rent={rent}
      setRent={setRent}
      capex={capex}
      view={view}
      setView={setView}
      margin={margin}
      setMargin={setMargin}
      esi={esi}
      setEsi={setEsi}
      svcRev={svcRev}
      setSvcRev={setSvcRev}
      base={base}
      setBaseField={setBaseField}
      facility={facility}
      setFacilityField={setFacilityField}
      tiers={tiers}
      setTiersCaptureField={setTiersCaptureField}
      setTiersScalarField={setTiersScalarField}
    />
  );
}

function DashboardStage({
  C, header, scen, setScen, growth, setGrowth, infl, setInfl, capexParts, setCapexParts, rent, setRent, capex,
  view, setView, margin, setMargin, esi, setEsi, svcRev, setSvcRev, base, setBaseField, facility, setFacilityField,
  tiers, setTiersCaptureField, setTiersScalarField,
}) {
  const data = useMemo(() => computeModel({ scen, growth, rent, capex, infl, margin, esi, svcRev, base, tiers }), [scen, growth, rent, capex, infl, margin, esi, svcRev, base, tiers]);
  const y3 = data.years[2];
  const daily = (y3.er + y3.obs + y3.opd + y3.wound + y3.ped) / 365;
  const pbColor = (pb) => (pb == null ? "#7A1024" : pb <= 5 ? C.green : pb <= 7 ? C.amber : C.red);
  const utilColor = (util) => (util >= 1 ? C.red : util >= 0.9 ? C.red : util >= 0.7 ? C.amber : C.green);
  const alertBg = C === DARK ? "#3A1D25" : "#FDE8EC";

  const buildCapacityRows = (yearData) => {
    const mixTotal = esi.reduce((sum, row) => sum + row.mix, 0) || 1;
    const horizontalShare = (esi[0].mix + esi[1].mix + 0.5 * esi[2].mix) / mixTotal;
    const razShare = (0.5 * esi[2].mix + esi[3].mix + esi[4].mix) / mixTotal;
    const operatingDays = 312;
    const peakFactor = 1.46;
    const demandByKey = {
      erHoriz: (yearData.er / 365) * horizontalShare,
      raz: (yearData.er / 365) * razShare,
      obs: yearData.obs / 365,
      ped: yearData.ped / operatingDays,
      wound: yearData.wound / operatingDays,
      opd: yearData.opd / operatingDays,
    };

    return CAPACITY_ROW_META.map((row) => {
      const units = facility[row.facilityKey];
      const demand = demandByKey[row.key];
      const capacityPerDay = units * row.capPerUnit;
      const peakDemand = demand * peakFactor;
      const peakUtil = capacityPerDay > 0 ? peakDemand / capacityPerDay : Infinity;
      const neededUnits = Math.max(units, Math.ceil(peakDemand / row.capPerUnit));
      const extraUnits = Math.max(0, neededUnits - units);
      const status = peakUtil >= 1 ? `Need +${extraUnits} ${row.unitName}` : peakUtil >= 0.9 ? "Tight" : peakUtil >= 0.7 ? "Watch" : "OK";
      const avgFte = (demand * row.staffHours * row.staffDays) / 1680;
      const peakFte = (peakDemand * row.staffHours * row.staffDays) / 1680;

      return { ...row, units, demand, capacityPerDay, avgUtil: capacityPerDay > 0 ? demand / capacityPerDay : Infinity, peakDemand, peakUtil, avgFte, peakFte, extraUnits, status };
    });
  };

  const capacity = useMemo(() => buildCapacityRows(y3), [esi, y3, facility]);
  const totalPeakFte = capacity.reduce((sum, row) => sum + row.peakFte, 0);
  const yearlySupply = useMemo(() => data.years.map((yearData) => {
    const rows = buildCapacityRows(yearData);
    const totalFte = rows.reduce((sum, row) => sum + row.peakFte, 0);
    const resourceNeeds = rows.filter((row) => row.extraUnits > 0).map((row) => `${row.label} +${row.extraUnits} ${row.unitName}`);
    const staffNeed = Math.max(0, totalFte - base.staffBaselineFte);
    const triggers = [...resourceNeeds, ...(staffNeed > 0 ? [`Staff +${staffNeed.toFixed(1)} FTE`] : [])];
    return { trigger: triggers.length > 0, text: triggers.length > 0 ? triggers.join("; ") : "OK", totalFte };
  }), [data.years, esi, facility, base.staffBaselineFte]);

  const tornado = useMemo(() => {
    const baseInputs = { scen, growth, rent, capex, infl, margin, esi, svcRev, base, tiers };
    const payback = (inputs) => computeModel(inputs).payG ?? 11;
    const basePb = payback(baseInputs);
    const scaleEsi = (factor) => esi.map((row) => ({ ...row, rev: row.rev * factor }));
    const shiftMargin = (delta) => Object.fromEntries(Object.entries(margin).map(([key, value]) => [key, Math.min(95, Math.max(40, value + delta))]));
    const scaleSvcRev = (factor) => Object.fromEntries(Object.entries(svcRev).map(([key, value]) => [key, value * factor]));
    const variables = [
      { label: "Rent ±150K/mo", lo: { rent: Math.max(0, rent - 150000) }, hi: { rent: rent + 150000 } },
      { label: "ER rev/bill ±15%", lo: { esi: scaleEsi(0.85) }, hi: { esi: scaleEsi(1.15) } },
      { label: "Other rev/bill ±15%", lo: { svcRev: scaleSvcRev(0.85) }, hi: { svcRev: scaleSvcRev(1.15) } },
      { label: "Margin all services ±5pp", lo: { margin: shiftMargin(-5) }, hi: { margin: shiftMargin(5) } },
      { label: "Demand growth ±2pp", lo: { growth: Math.max(0, growth - 0.02) }, hi: { growth: growth + 0.02 } },
      { label: "CapEx total ±10M", lo: { capex: Math.max(0, capex - 10) }, hi: { capex: capex + 10 } },
      { label: "OpEx inflation ±1pp", lo: { infl: Math.max(0, infl - 0.01) }, hi: { infl: infl + 0.01 } },
    ];
    const rows = variables.map((variable) => ({
      label: variable.label,
      dLo: payback({ ...baseInputs, ...variable.lo }) - basePb,
      dHi: payback({ ...baseInputs, ...variable.hi }) - basePb,
    }));
    rows.sort((a, b) => Math.max(Math.abs(b.dLo), Math.abs(b.dHi)) - Math.max(Math.abs(a.dLo), Math.abs(a.dHi)));
    const maxAbs = Math.max(0.05, ...rows.flatMap((row) => [Math.abs(row.dLo), Math.abs(row.dHi)]));
    return { basePb, rows, maxAbs };
  }, [scen, growth, rent, capex, infl, margin, esi, svcRev, base, tiers]);

  const setAllScenarios = (s) => setScen({ er: s, obs: s, opd: s, wound: s, ped: s });
  const setEsiField = (index, field, value) => setEsi(esi.map((row, i) => (i === index ? { ...row, [field]: value } : row)));

  return (
    <main className="min-h-screen p-4 md:p-6" style={{ background: C.bg, color: C.ink, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {header}

      <div className="flex flex-col lg:flex-row gap-5">
        <aside className="lg:w-80 shrink-0">
          <Panel C={C}>
            <div className="flex justify-between items-center gap-2 mb-2">
              <b style={{ color: C.navyDeep }}>1 · Volume by service</b>
              <div className="flex gap-1">
                {["C", "R", "A"].map((s) => (
                  <button key={s} className="px-2 py-0.5 rounded text-xs font-bold" onClick={() => setAllScenarios(s)} style={{ background: C.hilite, color: C.navy, border: `1px solid ${C.line}` }} title={`Set all services to ${SCENARIO_LABELS[s]}`}>
                    All {s}
                  </button>
                ))}
              </div>
            </div>
            {[
              { key: "er", volume: y3.er, price: data.erRev },
              { key: "obs", volume: y3.obs, price: svcRev.obs },
              { key: "opd", volume: y3.opd, price: svcRev.opd },
              { key: "wound", volume: y3.wound, price: svcRev.wound },
              { key: "ped", volume: y3.ped, price: svcRev.ped },
            ].map((row) => (
              <div key={row.key} className="flex items-center gap-2 py-1.5" style={{ borderTop: `1px solid ${C.line}` }}>
                <div className="w-28 shrink-0">
                  <div className="text-xs font-bold">{SERVICE_LABELS[row.key]}</div>
                  <div className="text-xs tabular-nums" style={{ color: C.muted }}>Y3: {Math.round(row.volume / 12).toLocaleString()}/mo</div>
                  <div className="text-xs tabular-nums font-medium" style={{ color: C.navy }}>฿{Math.round(row.price).toLocaleString()}/bill</div>
                </div>
                <div className="flex gap-1 flex-1">
                  {["C", "R", "A"].map((s) => (
                    <button key={s} className="flex-1 py-1.5 rounded text-xs font-bold" onClick={() => setScen({ ...scen, [row.key]: s })} style={{ background: scen[row.key] === s ? C.navy : C.hilite, color: scen[row.key] === s ? "#fff" : C.navy, border: `1px solid ${scen[row.key] === s ? C.navy : C.line}` }} title={SCENARIO_LABELS[s]}>
                      {s}
                      <span className="block font-normal" style={{ fontSize: 9, opacity: 0.85 }}>{scenarioHint(row.key, s, tiers)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </Panel>

          <Panel C={C}>
            <b style={{ color: C.navyDeep }}>2 · Assumptions</b>
            <div className="mt-3">
              <Slider C={C} label="Demand growth /yr" value={growth} set={setGrowth} min={0} max={0.1} step={0.005} format={(v) => `${(v * 100).toFixed(1)}%`} />
              <Slider C={C} label="OpEx inflation /yr" value={infl} set={setInfl} min={0} max={0.08} step={0.005} format={(v) => `${(v * 100).toFixed(1)}%`} />
              <Slider C={C} label="CapEx · Construction" value={capexParts.construction} set={(v) => setCapexParts({ ...capexParts, construction: v })} min={5} max={200} step={1} format={(v) => `${v}M`} />
              <Slider C={C} label="CapEx · Med equipment" value={capexParts.equipment} set={(v) => setCapexParts({ ...capexParts, equipment: v })} min={1} max={100} step={1} format={(v) => `${v}M`} />
              <Slider C={C} label="CapEx · IT" value={capexParts.it} set={(v) => setCapexParts({ ...capexParts, it: v })} min={0} max={30} step={1} format={(v) => `${v}M`} />
              <Slider C={C} label="Rent THB/month" value={rent} set={setRent} min={0} max={1000000} step={5000} format={(v) => `${(v / 1000).toFixed(0)}K`} />
              <div className="text-xs" style={{ color: C.muted }}>Total CapEx = {capex.toFixed(0)}M</div>
            </div>
          </Panel>

          <Panel C={C}>
            <b style={{ color: C.navyDeep }}>3 · Contribution margin</b>
            <div className="text-xs mt-1 mb-3" style={{ color: C.muted }}>Adjust margin for each core service. This changes variable cost and net cash flow immediately.</div>
            {["er", "obs", "opd", "wound", "ped"].map((key) => (
              <Slider key={key} C={C} label={SERVICE_LABELS[key]} value={margin[key]} set={(v) => setMargin({ ...margin, [key]: v })} min={20} max={95} step={1} format={(v) => `${v}%`} />
            ))}
          </Panel>

          <Panel C={C}>
            <b style={{ color: C.navyDeep }}>4 · Acuity mix and rate</b>
            <div className="text-xs mt-1 mb-3" style={{ color: C.muted }}>
              Weighted ER revenue/case: <b style={{ color: C.navy }}>{data.erRev.toFixed(0)} THB</b>
            </div>
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr style={{ color: C.muted }}>
                  <th className="text-left py-1">Tier</th>
                  <th className="text-right py-1">Mix %</th>
                  <th className="text-right py-1">Rev/bill</th>
                </tr>
              </thead>
              <tbody>
                {esi.map((row, i) => (
                  <tr key={row.label} style={{ borderTop: `1px solid ${C.line}` }}>
                    <td className="py-1 font-medium">{row.label}</td>
                    <td className="py-1 text-right"><NumInput C={C} value={row.mix} step={0.1} onChange={(v) => setEsiField(i, "mix", v)} width={14} /></td>
                    <td className="py-1 text-right"><NumInput C={C} value={row.rev} step={500} onChange={(v) => setEsiField(i, "rev", v)} width={20} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel C={C}>
            <b style={{ color: C.navyDeep }}>5 · Rev/bill · other services</b>
            <div className="text-xs mt-1 mb-3" style={{ color: C.muted }}>ER uses weighted acuity revenue. Adjust other service prices here.</div>
            {[
              { key: "obs", label: "Inpatient Observation", step: 500 },
              { key: "opd", label: "OPD General", step: 100 },
              { key: "wound", label: "Specialty Clinic", step: 100 },
              { key: "ped", label: "Pediatric", step: 100 },
            ].map((row) => (
              <label key={row.key} className="flex justify-between items-center gap-2 py-1.5 text-xs" style={{ borderTop: `1px solid ${C.line}` }}>
                <span className="font-medium">{row.label}</span>
                <NumInput C={C} value={svcRev[row.key]} step={row.step} onChange={(v) => setSvcRev({ ...svcRev, [row.key]: v })} width={20} />
              </label>
            ))}
          </Panel>

          <Panel C={C}>
            <b style={{ color: C.navyDeep }}>6 · Scenario capture tiers</b>
            <div className="text-xs mt-1 mb-3" style={{ color: C.muted }}>Advanced: tune what Conservative / Realistic / Aggressive mean for this project.</div>
            <div className="text-xs font-bold mb-1" style={{ color: C.muted }}>ER capture rate Y1 / Y2 / Y3</div>
            {["C", "R", "A"].map((tier) => (
              <div key={tier} className="flex items-center gap-1 mb-1.5 text-xs">
                <span className="w-4 font-bold" style={{ color: C.navy }}>{tier}</span>
                {[0, 1, 2].map((yi) => (
                  <NumInput key={yi} C={C} value={Math.round(tiers.capture[tier][yi] * 1000) / 1000} step={0.01} onChange={(v) => setTiersCaptureField(tier, yi, v)} width={18} />
                ))}
              </div>
            ))}
            {[
              { group: "obsCap", label: "Observation pool capture" },
              { group: "opdRatio", label: "OPD visits as x of ER" },
              { group: "specialtyMult", label: "Specialty follow-up multiplier" },
              { group: "pedFactor", label: "Pediatric scenario factor" },
            ].map(({ group, label }) => (
              <div key={group} className="mt-2">
                <div className="text-xs font-bold mb-1" style={{ color: C.muted }}>{label}</div>
                <div className="flex items-center gap-1">
                  {["C", "R", "A"].map((tier) => (
                    <label key={tier} className="flex items-center gap-1 text-xs">
                      <span style={{ color: C.navy }}>{tier}</span>
                      <NumInput C={C} value={tiers[group][tier]} step={group === "specialtyMult" ? 1 : 0.01} onChange={(v) => setTiersScalarField(group, tier, v)} width={16} />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </Panel>
        </aside>

        <section className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-3 mb-4">
            <Card C={C} label="Y3 volume" value={`${daily.toFixed(0)}/day`} sub={`${Math.round((y3.er + y3.opd + y3.wound + y3.ped + y3.obs) / 12).toLocaleString()}/mo`} accent={C.navy} />
            <Card C={C} label="Payback Group" value={fmtY(data.payG)} sub={`CapEx ${capex}M`} accent={pbColor(data.payG)} />
            <Card C={C} label="Payback Standalone" value={fmtY(data.payS)} sub="Facility direct only" accent={pbColor(data.payS)} />
            <Card C={C} label="Peak funding need" value={fmtM(data.minG)} sub="Group cumulative drawdown" accent={C.red} />
            <Card C={C} label="Y3 facility net" value={fmtM(y3.netS)} sub={`Rev ${fmtM(y3.spokeRev)} - OpEx ${fmtM(y3.opex)}`} accent={y3.netS >= 0 ? C.green : C.amber} />
          </div>

          <Panel C={C}>
            <div className="flex justify-between items-center mb-2">
              <b style={{ color: C.navyDeep }}>Cumulative cash and annual net</b>
              <div className="flex gap-1">{["G", "S"].map((k) => <button key={k} className="px-3 py-1 rounded text-xs font-bold" onClick={() => setView(k)} style={{ background: view === k ? C.navy : C.hilite, color: view === k ? "#fff" : C.navy }}>{k === "G" ? "Group" : "Standalone"}</button>)}</div>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={data.years}>
                <CartesianGrid stroke={C.line} strokeDasharray="3 3" />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: C.muted }} />
                <YAxis tick={{ fontSize: 11, fill: C.muted }} tickFormatter={(v) => `${v}M`} />
                <Tooltip formatter={(v) => [fmtM(v)]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke={C.red} strokeWidth={2} />
                <Bar dataKey={view === "G" ? "netG" : "netS"} name="Annual net" fill={C.hilite} stroke={C.navy} />
                <Line type="monotone" dataKey="cumG" name="Cumulative Group" stroke={C.navy} strokeWidth={3} />
                <Line type="monotone" dataKey="cumS" name="Cumulative Standalone" stroke={C.muted} strokeWidth={2} strokeDasharray="6 3" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </Panel>

          <Panel C={C}>
            <b style={{ color: C.navyDeep }}>Revenue build by service</b>
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={data.years}>
                <CartesianGrid stroke={C.line} strokeDasharray="3 3" />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: C.muted }} />
                <YAxis tick={{ fontSize: 11, fill: C.muted }} tickFormatter={(v) => `${v}M`} />
                <Tooltip formatter={(v) => [fmtM(v)]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area stackId="r" dataKey="revER" name="ER" fill={C.navy} stroke={C.navy} />
                <Area stackId="r" dataKey="revOPD" name="OPD" fill="#3E6FA3" stroke="#3E6FA3" />
                <Area stackId="r" dataKey="revPed" name="Pediatric" fill="#6E98C4" stroke="#6E98C4" />
                <Area stackId="r" dataKey="revWound" name="Specialty" fill="#A3C0DC" stroke="#A3C0DC" />
                <Area stackId="r" dataKey="revObs" name="Obs" fill={C.red} stroke={C.red} />
                <Area stackId="r" dataKey="downstream" name="Downstream" fill={C.green} stroke={C.green} fillOpacity={0.5} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          <Panel C={C}>
            <b style={{ color: C.navyDeep }}>Capacity vs demand · beds, chairs, rooms</b>
            <div className="text-xs mt-1 mb-3" style={{ color: C.muted }}>
              Predictive supply trigger at current Y3 scenario. Peak day uses 1.46x high-season factor. Modeled peak staffing need: <b style={{ color: C.navy }}>{totalPeakFte.toFixed(1)} FTE</b> vs baseline {base.staffBaselineFte} FTE. Unit counts are editable and come from your facility design.
            </div>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr style={{ background: C.navy, color: "#fff" }}>
                    {["Zone", "Units", "Supply", "Cap/day", "Avg/day", "Avg util", "Peak/day", "Peak util", "FTE peak", "Trigger"].map((h) => (
                      <th key={h} className="px-2 py-1.5 text-right first:text-left whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {capacity.map((row) => {
                    const color = utilColor(row.peakUtil);
                    return (
                      <tr key={row.key} style={{ background: C.card, borderBottom: `1px solid ${C.line}` }}>
                        <td className="px-2 py-1 font-medium">{row.label}</td>
                        <td className="px-2 py-1 text-right">
                          <NumInput C={C} value={row.units} step={1} onChange={(v) => setFacilityField(row.facilityKey, Math.max(0, v))} width={10} />
                          <span style={{ color: C.muted }}> {row.unitName}</span>
                        </td>
                        <td className="px-2 py-1 text-right" style={{ color: C.muted }}>{row.supply}</td>
                        <td className="px-2 py-1 text-right">{row.capacityPerDay.toFixed(1)}</td>
                        <td className="px-2 py-1 text-right">{row.demand.toFixed(1)}</td>
                        <td className="px-2 py-1 text-right">{Number.isFinite(row.avgUtil) ? `${(row.avgUtil * 100).toFixed(0)}%` : "—"}</td>
                        <td className="px-2 py-1 text-right">{row.peakDemand.toFixed(1)}</td>
                        <td className="px-2 py-1 text-right font-bold" style={{ color }}>{Number.isFinite(row.peakUtil) ? `${(row.peakUtil * 100).toFixed(0)}%` : "—"}</td>
                        <td className="px-2 py-1 text-right font-bold">{row.peakFte.toFixed(1)}</td>
                        <td className="px-2 py-1 text-right">
                          <span className="px-2 py-0.5 rounded font-bold" style={{ background: color, color: "#fff", fontSize: 10 }}>{row.status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="text-xs mt-2 leading-relaxed" style={{ color: C.muted }}>
              Modeled throughput assumes ER bay 4 hr, RAZ chair 0.75 hr, obs bed 16.5 hr, OPD/Ped/Specialty 20-25 min per visit, 9 hr/day, 312 clinic days/year. FTE uses 1,680 productive hours/year; validate with clinical operations before final design.
            </div>
          </Panel>

          <Panel C={C}>
            <b style={{ color: C.navyDeep }}>Y1-Y10 P&L</b>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-xs tabular-nums">
                <thead><tr style={{ background: C.navy, color: "#fff" }}>{["Year", "Total OPD/mo", "ER/mo", "OPD/mo", "Specialty/mo", "Ped/mo", "Obs/mo", "ER/day", "Supply trigger", "Facility Rev", "OpEx", "Net S", "Downstream", "Net G", "Cum G"].map((h) => <th key={h} className="px-2 py-1.5 text-right first:text-left whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody>
                  {data.years.map((r, i) => {
                    const supply = yearlySupply[i];
                    const rowBg = supply.trigger ? alertBg : i === 2 ? C.hilite : C.card;
                    return (
                      <tr key={r.year} style={{ background: rowBg, borderBottom: `1px solid ${C.line}` }}>
                        <td className="px-2 py-1 font-bold">{r.year}{i === 2 ? " *" : ""}</td>
                        <td className="px-2 py-1 text-right font-bold">{Math.round((r.er + r.opd + r.wound + r.ped) / 12).toLocaleString()}</td>
                        <td className="px-2 py-1 text-right">{Math.round(r.er / 12).toLocaleString()}</td>
                        <td className="px-2 py-1 text-right">{Math.round(r.opd / 12).toLocaleString()}</td>
                        <td className="px-2 py-1 text-right">{Math.round(r.wound / 12).toLocaleString()}</td>
                        <td className="px-2 py-1 text-right">{Math.round(r.ped / 12).toLocaleString()}</td>
                        <td className="px-2 py-1 text-right font-bold">{Math.round(r.obs / 12).toLocaleString()}</td>
                        <td className="px-2 py-1 text-right">{(r.er / 365).toFixed(1)}</td>
                        <td className="px-2 py-1 text-right font-bold" style={{ color: supply.trigger ? C.red : C.green }}>{supply.text}</td>
                        <td className="px-2 py-1 text-right">{r.spokeRev.toFixed(1)}</td>
                        <td className="px-2 py-1 text-right">{r.opex.toFixed(1)}</td>
                        <td className="px-2 py-1 text-right">{r.netS.toFixed(1)}</td>
                        <td className="px-2 py-1 text-right">{r.downstream.toFixed(1)}</td>
                        <td className="px-2 py-1 text-right">{r.netG.toFixed(1)}</td>
                        <td className="px-2 py-1 text-right font-bold">{r.cumG.toFixed(0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="text-xs mt-2 leading-relaxed" style={{ color: C.muted }}>
              Light red rows mean the year exceeds bed/room/chair/bay capacity or the modeled staff need is above your baseline FTE. OPD/mo includes ER, OPD General, Specialty, and Pediatric visits; Obs/mo is separated for bed pressure.
            </div>
          </Panel>

          <Panel C={C}>
            <b style={{ color: C.navyDeep }}>Sensitivity tornado · payback Group shift</b>
            <div className="text-xs mt-1 mb-3" style={{ color: C.muted }}>
              Base payback = {fmtY(tornado.basePb >= 11 ? null : tornado.basePb)}. Values show payback-year movement when each variable moves down/up.
            </div>
            {tornado.rows.map((row) => (
              <div key={row.label} className="flex items-center gap-2 mb-1.5">
                <div className="w-44 shrink-0 text-xs text-right pr-1">{row.label}</div>
                <div className="flex-1 relative h-5 rounded" style={{ background: C.bg }}>
                  <div className="absolute top-0 bottom-0" style={{ left: "50%", width: 1, background: C.muted }} />
                  <div
                    className="absolute top-0.5 bottom-0.5 rounded-sm"
                    style={row.dLo <= 0
                      ? { right: "50%", width: `${(Math.abs(row.dLo) / tornado.maxAbs) * 48}%`, background: C.green }
                      : { left: "50%", width: `${(Math.abs(row.dLo) / tornado.maxAbs) * 48}%`, background: C.red, opacity: 0.55 }}
                  />
                  <div
                    className="absolute top-0.5 bottom-0.5 rounded-sm"
                    style={row.dHi >= 0
                      ? { left: "50%", width: `${(Math.abs(row.dHi) / tornado.maxAbs) * 48}%`, background: C.red }
                      : { right: "50%", width: `${(Math.abs(row.dHi) / tornado.maxAbs) * 48}%`, background: C.green, opacity: 0.55 }}
                  />
                </div>
                <div className="w-28 shrink-0 text-xs tabular-nums" style={{ color: C.muted }}>
                  {row.dLo >= 0 ? "+" : "-"}{Math.abs(row.dLo).toFixed(1)} / {row.dHi >= 0 ? "+" : "-"}{Math.abs(row.dHi).toFixed(1)} yr
                </div>
              </div>
            ))}
            <div className="text-xs mt-2" style={{ color: C.muted }}>Green means faster payback; red means slower payback. Payback beyond Y10 is clamped at Y11 for comparison.</div>
          </Panel>
        </section>
      </div>
    </main>
  );
}
