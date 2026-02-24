import { useEffect, useMemo, useRef, useState } from "react";
import logoFull from "./assets/icons/extractor-logo-full-svg.svg";
import logoPartial from "./assets/icons/extractor-logo-partial-svg.svg";
import logoSmall from "./assets/icons/extractor-logo-small-svg.svg";
import burgerMenu from "./assets/icons/burger-menu.svg";
import enterIcon from "./assets/icons/input-enterIcon.svg";
import socialFacebook from "./assets/icons/socialFacebook.svg";
import socialTwitter from "./assets/icons/socialTwitter.svg";
import socialTikTok from "./assets/icons/socialTikTok.svg";
import wavyBackground from "./assets/images/WavyBackground.svg";
import consultingImage from "./assets/images/consultingImage.png";
import financeTeamImage from "./assets/images/financeTeamImage.png";
import lawFirmImage from "./assets/images/lawFirmImage.png";
import operationsImage from "./assets/images/operationsImage.png";
import procurementImage from "./assets/images/procurementImage.png";
import startupImage from "./assets/images/startupImage.png";
import chevronDown from "./assets/icons/chevron-down.svg";
import repeatableOutputIcon from "./assets/icons/repeatableOutput.svg";
import auditReadyIcon from "./assets/icons/auditReady.svg";
import operationFirstIcon from "./assets/icons/operationFirst.svg";
import noThirdPartyIcon from "./assets/icons/noThirdParty.svg";
import privateIcon from "./assets/icons/Private.svg";
import exportReadyIcon from "./assets/icons/exportReady.svg";
import priceTier1 from "./assets/icons/PriceTier1.svg";
import priceTier2 from "./assets/icons/PriceTier2.svg";
import priceTier3 from "./assets/icons/PriceTier3.svg";
import MailerLiteForm from "./MailerLiteForm";

type ExtractedItem = {
  id: string;
  type: "renewal" | "notice" | "payment" | "term_end" | "trial_end" | "other";
  date: string | null;
  confidence: "high" | "medium" | "low";
  item: string;
  snippet: string;
  notes?: string;
  source: string;
  location?: string;
};

type FileReport = {
  source: string;
  ok: boolean;
  error?: string;
  chars?: number;
};

type ApiResponse = {
  items: ExtractedItem[];
  fileReports: FileReport[];
};

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
const CLIENT_MAX_BYTES = 20 * 1024 * 1024;
const INITIAL_RESULTS_VISIBLE = 10;
const MAX_RESULTS_VISIBLE = 150;
const USE_CASE_CARDS = [
  {
    id: "consulting",
    title: "Consulting Firms",
    image: consultingImage,
    tags: ["Diligence Work", "Integration Audits", "Client Reporting"],
    copy:
      "Consulting teams often inherit contracts spread across drives, PDFs, and spreadsheets. This tool creates a structured deadline register instead of fragmented notes, helping diligence and post-close teams avoid missed notice windows."
  },
  {
    id: "finance",
    title: "Finance & Audit",
    image: financeTeamImage,
    tags: ["Invoice Timing", "Budget Planning", "Renewal Tracking"],
    copy:
      "Finance teams often discover renewals only after an invoice reaches AP. Deterministic extraction surfaces payment due dates, notice cutoffs, and term-end obligations early enough to budget, renegotiate, or cancel."
  },
  {
    id: "operations",
    title: "Operations",
    image: operationsImage,
    tags: ["Owner Handoff", "Renewal Calendar", "Escalation Control"],
    copy:
      "Operations teams are usually asked to fix renewal misses after the fact. A deterministic reminder sheet creates a clean handoff to owners and reduces firefighting around accidental auto-renewals and last-minute escalations."
  },
  {
    id: "procurement",
    title: "Procurement Teams",
    image: procurementImage,
    tags: ["Vendor Terms", "Notice Windows", "Negotiation Prep"],
    copy:
      "Procurement teams manage contracts with vendor-favorable auto-renew and notice clauses. Standardized extraction helps teams start negotiations earlier and avoid lock-in caused by missed termination windows."
  },
  {
    id: "startup",
    title: "Startup & Admin",
    image: startupImage,
    tags: ["Lean Ops", "Deadline Control", "No CLM Needed"],
    copy:
      "Startups often run contract ops without dedicated legal or procurement support. This gives founders and admins a practical way to catch renewal and notice deadlines before they become expensive surprises."
  },
  {
    id: "legal-ops",
    title: "Legal Operations",
    image: lawFirmImage,
    tags: ["Clause Review", "Audit Trail", "Consistent Reads"],
    copy:
      'Legal ops teams often need to validate ambiguous wording such as "at least X months before term end" and confirm what triggers auto-renewal. Source-linked extraction makes review faster and more consistent across reviewers.'
  }
] as const;

export default function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ExtractedItem[]>([]);
  const [reports, setReports] = useState<FileReport[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openLegal, setOpenLegal] = useState({
    terms: false,
    refund: false,
    privacy: false
  });
  const [showAllResults, setShowAllResults] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const menuWrapRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onResize() {
      if (window.innerWidth > 768) {
        setMenuOpen(false);
      }
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    function onDocClick(e: MouseEvent) {
      if (!menuOpen || !menuWrapRef.current) return;
      const target = e.target as Node | null;
      if (!target) return;
      if (!menuWrapRef.current.contains(target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onDocClick);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [menuOpen]);

  const tooManyFiles = files.length > 3;
  const oversized = files.some((f) => f.size > CLIENT_MAX_BYTES);
  const hasInput = files.length > 0 || !!text.trim();

  async function submitAccessCode() {
    const code = accessCode.trim();
    if (!code) return;
    try {
      const res = await fetch(`${API_BASE}/api/access-codes/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Invalid or expired access code.");
        return;
      }
      setError(null);
      localStorage.setItem("dr_access_code", code);
      setMenuOpen(false);
    } catch {
      setError("Network error while validating access code.");
    }
  }

  function onAccessKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void submitAccessCode();
    }
  }

  useEffect(() => {
    const stored = (localStorage.getItem("dr_access_code") || "").trim();
    if (stored) setAccessCode(stored);
  }, []);

  async function onExtract() {
    setError(null);
    if (!hasInput) {
      setError("Add pasted text or upload at least one file before extracting.");
      return;
    }
    if (tooManyFiles) {
      setError("You can upload up to 3 files.");
      return;
    }
    if (oversized) {
      setError("Each file must be 20MB or smaller.");
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      if (text.trim()) fd.append("text", text);
      if (accessCode.trim()) fd.append("accessCode", accessCode.trim());
      const res = await fetch(`${API_BASE}/api/extract`, {
        method: "POST",
        headers: {
          "x-plan": "free",
          ...(accessCode.trim() ? { "x-access-code": accessCode.trim() } : {})
        },
        body: fd
      });
      const data = (await res.json()) as ApiResponse | { error: string };
      if (!res.ok) {
        throw new Error("error" in data ? data.error : "Request failed.");
      }
      setItems((data as ApiResponse).items);
      setReports((data as ApiResponse).fileReports);
      setFiles([]);
      setText("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setLoading(false);
    }
  }

  function sanitizeFilenameToken(value: string) {
    return (
      value
        .toLowerCase()
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "reminder-sheet"
    );
  }

  function buildReminderFilename(ext: "csv" | "txt") {
    const uniqueSources = Array.from(new Set(items.map((i) => (i.source || "").trim()).filter(Boolean)));
    const nonTextSources = uniqueSources.filter((s) => s.toLowerCase() !== "pasted text");

    if (nonTextSources.length === 1) {
      return `${sanitizeFilenameToken(nonTextSources[0])}-reminder-sheet.${ext}`;
    }

    if (nonTextSources.length > 1) {
      const first = sanitizeFilenameToken(nonTextSources[0]);
      return `${first}-plus-${nonTextSources.length - 1}-files-reminder-sheet.${ext}`;
    }

    if (uniqueSources.some((s) => s.toLowerCase() === "pasted text")) {
      return `pasted-text-reminder-sheet.${ext}`;
    }

    return `reminder-sheet.${ext}`;
  }

  function downloadCsv() {

    const rows = [
      ["Item", "Date", "Type", "Source Snippet", "Confidence", "Source", "Location", "Notes"],
      ...items.map((i) => [i.item, i.date || "", i.type, i.snippet, i.confidence, i.source, i.location || "", i.notes || ""])
    ];
    const csv = rows
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = buildReminderFilename("csv");
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function downloadTxt() {
    const lines = items.map(
      (i) =>
        `${i.item} | ${i.date || "null"} | ${i.type} | ${i.confidence} | ${i.source} | ${i.location || ""}\nSnippet: ${
          i.snippet
        }\nNotes: ${i.notes || ""}\n`
    );
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = buildReminderFilename("txt");
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.localeCompare(b.date);
      }),
    [items]
  );

  useEffect(() => {
    setShowAllResults(false);
  }, [items]);

  const hasExpandableResults = sortedItems.length > INITIAL_RESULTS_VISIBLE;
  const cappedResults = showAllResults ? sortedItems.slice(0, MAX_RESULTS_VISIBLE) : sortedItems.slice(0, INITIAL_RESULTS_VISIBLE);
  const hasOverflowBeyondCap = sortedItems.length > MAX_RESULTS_VISIBLE;

  return (
    <>
      <header className="siteHeader">
        <div className="siteHeaderInner">
          <a className="brand" href="/" aria-label="Deadline Extractor">
            <img src={logoFull} alt="Deadline Extractor" className="logo logoFull" />
            <img src={logoPartial} alt="Deadline Extractor" className="logo logoPartial" />
            <img src={logoSmall} alt="Deadline Extractor" className="logo logoSmall" />
          </a>
          <nav className="siteNav navActionsDesktop">
            <a className="siteCta" href="#extract">
              <span className="navBtnLabel">Try Extractor</span>
            </a>
            <div className="navAccess">
              <div className="accesscode-wrap">
                <input
                  className="accesscode-input"
                  type="text"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  onKeyDown={onAccessKeyDown}
                  placeholder="Insert Access Code"
                  aria-label="Access code"
                />
                <button type="button" className="accesscode-submit" onClick={submitAccessCode} aria-label="Submit access code">
                  <img src={enterIcon} alt="" aria-hidden="true" />
                </button>
              </div>
            </div>
          </nav>
          <div className="navActionsMobile" ref={menuWrapRef}>
            <button
              className="menuToggle navMenuBtn"
              type="button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="nav-menu-panel"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <img src={burgerMenu} alt="" className="navMenuSvg" />
            </button>
            {menuOpen && (
              <div id="nav-menu-panel" className="navMenuPanel">
                <a className="navMenuItem" href="#extract" onClick={() => setMenuOpen(false)}>
                  Try Extractor
                </a>
                <a className="navMenuItem" href="#pricing" onClick={() => setMenuOpen(false)}>
                  Pricing
                </a>
                <a className="navMenuItem" href="#newsletter" onClick={() => setMenuOpen(false)}>
                  Newsletter
                </a>
                <div className="navMenuDivider" />
                <div className="navMenuSectionLabel">Access Code</div>
                <form
                  className="navMenuAccessForm"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitAccessCode();
                  }}
                >
                  <div className="accesscode-wrap accesscode-wrap-menu">
                    <input
                      className="accesscode-input"
                      type="text"
                      value={accessCode}
                      onChange={(e) => setAccessCode(e.target.value)}
                      onKeyDown={onAccessKeyDown}
                      placeholder="Insert Access Code"
                      aria-label="Access code"
                    />
                    <button type="button" className="accesscode-submit" onClick={submitAccessCode} aria-label="Submit access code">
                      <img src={enterIcon} alt="" aria-hidden="true" />
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="wrap">
        <header className="heroFrame card">
          <div className="heroContent">
            <h1 className="heroAnim heroTitle">Build an Auditable Deadline Register, not a chat guess.</h1>
            <p className="heroAnim heroTitleSubline">Easy: Upload File (i.e. PDF) and Extract Results.</p>
            <p className="sub heroAnim heroSub">
            Extract renewals, notice dates, payment due dates, and term/trial endings with deterministic rules,
            source snippets, and repeatable output.
            </p>
          </div>
          <div className="heroBullets heroAnim heroPills">
            <span>Deterministic and repeatable</span>
            <span>No third-party OCR/AI</span>
            <span>Evidence snippets on every item</span>
            <span>No LLM upload required</span>
            <span>Private and Safe</span>
            <span>Export-ready reminders</span>
          </div>
          <a className="heroScrollCue heroAnim" href="#extract" aria-label="Scroll to Extract">
            <span>TRY NOW</span>
            <img src={chevronDown} alt="" />
          </a>
          <img src={wavyBackground} alt="" className="heroWave" aria-hidden="true" />
          <div className="heroGlow" aria-hidden="true" />
          <div className="heroFade" aria-hidden="true" />
          <div className="heroOverlay" aria-hidden="true" />
        </header>
        <section id="extract" className="extractSection card">
          <div className="extractSectionIntro">
            <h2 className="extractSectionTitle">
              <span className="extractSectionTitleBlack">DEADLINE AND </span>
              <span className="extractSectionTitleBlue">RENEWAL EXTRACTOR</span>
            </h2>
            <p className="extractSectionLead">
              Deadline & Renewal Extractor pulls key renewal and deadline obligations from text or documents into an
              auditable, exportable reminder sheet using deterministic rules (no AI/OCR). Try it now by uploading files
              or inputing text below . . .
            </p>
          </div>

          <div className="extractSectionFiles">
            <label className="extractSectionLabel">Upload files (PDF, DOCX, TXT | up to 3 files | 20MB max each)</label>
            <input
              ref={fileInputRef}
              className="extractSectionFileNative"
              type="file"
              multiple
              accept=".pdf,.docx,.txt,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
            <div className="extractSectionFileBar">
              <button type="button" className="extractSectionChoose" onClick={() => fileInputRef.current?.click()}>
                Choose Files
              </button>
              <span className="extractSectionFileText">
                {files.length ? files.map((f) => f.name).join(", ") : "No file chosen . . ."}
              </span>
            </div>
            <div className="extractSectionMeta">
              Selected: {files.length ? files.map((f) => f.name).join(", ") : "No files selected"}
            </div>
            <div className="extractSectionMeta">
              After uploading file(s), click Extract Deadlines below. Limits are enforced by plan.
            </div>
          </div>

          <div className="extractSectionText">
            <label className="extractSectionLabel">Optional Pasted Text</label>
            <textarea
              className="extractSectionTextarea"
              rows={9}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste contact or policy text here . . ."
            />
          </div>

          <div className="extractSectionCta">
            <button className="btn extractSectionSubmit" onClick={onExtract} disabled={loading || !hasInput}>
              {loading ? "Extracting" : "Extract Deadlines"}
            </button>
          </div>
          {error && <p className="err">{error}</p>}
        </section>

      <section className="card">
        <h2 className="valueSectionTitle">Why teams choose this over chat tools</h2>
        <div className="valueGrid">
          <article className="valueCard">
            <div className="valueCardIconWrap valueCardIconWrapPurple">
              <img src={repeatableOutputIcon} alt="" className="valueCardIcon" />
            </div>
            <h3>Repeatable Output</h3>
            <p>
              Run the same document twice and get the same extracted deadlines. No prompt tuning, no AI drift, and no
              output roulette.
            </p>
          </article>
          <article className="valueCard">
            <div className="valueCardIconWrap valueCardIconWrapGreen">
              <img src={auditReadyIcon} alt="" className="valueCardIcon" />
            </div>
            <h3>Audit-Ready Evidence</h3>
            <p>
              Every line item includes source snippets and deterministic notes so legal, finance, and operations can
              validate what was captured.
            </p>
          </article>
          <article className="valueCard">
            <div className="valueCardIconWrap valueCardIconWrapBlue">
              <img src={operationFirstIcon} alt="" className="valueCardIcon" />
            </div>
            <h3>Operations-First Handoff</h3>
            <p>
              Deadlines come out in a structured reminder sheet with CSV export, ready for trackers, workflows, and
              team follow-up.
            </p>
          </article>
          <article className="valueCard">
            <div className="valueCardIconWrap valueCardIconWrapOrange">
              <img src={noThirdPartyIcon} alt="" className="valueCardIcon" />
            </div>
            <h3>No Third-Party AI/OCR</h3>
            <p>
              Documents are parsed with deterministic extraction rules, without external AI/OCR services that add
              variability or extra risk.
            </p>
          </article>
          <article className="valueCard">
            <div className="valueCardIconWrap valueCardIconWrapTeal">
              <img src={privateIcon} alt="" className="valueCardIcon" />
            </div>
            <h3>Private and Safe Processing</h3>
            <p>
              Built for sensitive contract work where teams need controlled processing and clear handling boundaries
              for internal review.
            </p>
          </article>
          <article className="valueCard">
            <div className="valueCardIconWrap valueCardIconWrapAmber">
              <img src={exportReadyIcon} alt="" className="valueCardIcon" />
            </div>
            <h3>Export-Ready Reminders</h3>
            <p>
              Output ships in a reminder-sheet format with CSV export, making it fast to hand off into trackers and
              operational workflows.
            </p>
          </article>
        </div>
      </section>

      <section id="pricing" className="ttPricing">
        <div className="ttPricingInner">
          <h2 className="ttPricingTitle">
            <span className="accent">Upgrade</span> when you are ready
          </h2>
          <p className="ttPricingSubtitle">
            One-time pass purchases unlock higher extraction capacity with no auto-renewal.
          </p>

          <div className="ttPricingCardsWrap">
            <div className="ttPricingGrid">
              <article className="ttPricingCard">
                <div className="ttPricingCardHeader free ttPricingCardHeaderSwap">PRO 30-DAY PASS</div>
                <div className="ttPricingCardBody">
                  <div className="ttPricingTitleRow">
                    <img src={priceTier1} alt="" className="ttPricingIcon" />
                    <h3 className="ttPricingTitleSwap">300 Extractions Per Pass</h3>
                  </div>
                  <p className="ttPricingTagline">For short-term contract operations.</p>
                  <p className="ttPricingDescription">
                    One-time purchase with a 30-day access window. Good for focused review cycles and immediate
                    deadline cleanup.
                  </p>
                  <ul className="ttPricingFeatures">
                    <li>300 total extractions during pass period</li>
                    <li>Up to 3 files per extraction</li>
                    <li>Up to 10MB per file</li>
                  </ul>
                  <div className="ttPricingPrice">
                    $19 <span>one-time</span>
                  </div>
                  <button className="ttPricingBtn secondary" type="button">
                    Buy 30-Day Pass
                  </button>
                </div>
              </article>

              <article className="ttPricingCard ttPricingCardHighlight">
                <div className="ttPricingCardHeader plus ttPricingCardHeaderSwap">PRO ANNUAL PASS</div>
                <div className="ttPricingCardBody">
                  <div className="ttPricingTitleRow">
                    <img src={priceTier2} alt="" className="ttPricingIcon" />
                    <h3 className="ttPricingTitleSwap">1500 Extractions Per Pass</h3>
                  </div>
                  <p className="ttPricingTagline">For ongoing team workflows.</p>
                  <p className="ttPricingDescription">
                    One-time purchase with a 365-day access window. Built for teams handling renewals throughout the
                    year.
                  </p>
                  <ul className="ttPricingFeatures">
                    <li>1500 total extractions during pass period</li>
                    <li>Up to 3 files per extraction</li>
                    <li>Up to 20MB per file</li>
                  </ul>
                  <div className="ttPricingPrice">
                    $190 <span>one-time</span>
                  </div>
                  <button className="ttPricingBtn primary" type="button">
                    Buy Annual Pass
                  </button>
                </div>
              </article>

              <article className="ttPricingCard">
                <div className="ttPricingCardHeader pro ttPricingCardHeaderSwap">PRO LIFETIME PASS</div>
                <div className="ttPricingCardBody">
                  <div className="ttPricingTitleRow">
                    <img src={priceTier3} alt="" className="ttPricingIcon" />
                    <h3 className="ttPricingTitleSwap">5000 Extractions Per Year</h3>
                  </div>
                  <p className="ttPricingTagline">One payment, long-term access.</p>
                  <p className="ttPricingDescription">
                    Best for teams that want no expiration and predictable long-run access without renewals.
                  </p>
                  <ul className="ttPricingFeatures">
                    <li>5000 extractions per year (resets yearly)</li>
                    <li>Up to 3 files per extraction</li>
                    <li>Up to 20MB per file</li>
                  </ul>
                  <div className="ttPricingPrice">
                    $490 <span>one-time</span>
                  </div>
                  <button className="ttPricingBtn primary outline" type="button">
                    Buy Lifetime Pass
                  </button>
                </div>
              </article>
            </div>

            <p className="ttPricingDisclaimer">
              All passes are one-time purchases. No auto-renewal.
            </p>
          </div>

                    <div className="ttPricingTableWrap">
            <section className="ttComparePlans">
              <h3 className="ttCompareTitle">Compare Plans</h3>

              <div className="ttCompareCards" aria-label="Compare plans (mobile)">
                <div className="ttCompareCard">
                  <div className="ttCompareCardHead">
                    <div className="ttCompareCardPlan">PRO 30-DAY PASS</div>
                  </div>
                  <div className="ttCompareCardRows">
                    <div className="ttCompareCardRow">
                      <div className="ttCompareCardLabel">Extraction Allowance</div>
                      <div className="ttCompareCardValue ttCompareAccent">300 / 30 days</div>
                    </div>
                    <div className="ttCompareCardRow">
                      <div className="ttCompareCardLabel">Max Files / Extraction</div>
                      <div className="ttCompareCardValue">3</div>
                    </div>
                    <div className="ttCompareCardRow">
                      <div className="ttCompareCardLabel">Max File Size</div>
                      <div className="ttCompareCardValue">10MB</div>
                    </div>
                    <div className="ttCompareCardRow">
                      <div className="ttCompareCardLabel">Evidence Snippets + Notes</div>
                      <div className="ttCompareCardValue ttCompareCheck">&#10003;</div>
                    </div>
                    <div className="ttCompareCardRow">
                      <div className="ttCompareCardLabel">Priority Queue</div>
                      <div className="ttCompareCardValue ttCompareX">&times;</div>
                    </div>
                    <div className="ttCompareCardRow ttCompareCardRowFooter">
                      <div className="ttCompareCardLabel">Best Fit</div>
                      <div className="ttCompareCardValue">Short-Term Review Cycles</div>
                    </div>
                  </div>
                </div>

                <div className="ttCompareCard">
                  <div className="ttCompareCardHead">
                    <div className="ttCompareCardPlan">PRO ANNUAL PASS</div>
                  </div>
                  <div className="ttCompareCardRows">
                    <div className="ttCompareCardRow">
                      <div className="ttCompareCardLabel">Extraction Allowance</div>
                      <div className="ttCompareCardValue ttCompareAccent">1500 / 365 days</div>
                    </div>
                    <div className="ttCompareCardRow">
                      <div className="ttCompareCardLabel">Max Files / Extraction</div>
                      <div className="ttCompareCardValue">3</div>
                    </div>
                    <div className="ttCompareCardRow">
                      <div className="ttCompareCardLabel">Max File Size</div>
                      <div className="ttCompareCardValue">20MB</div>
                    </div>
                    <div className="ttCompareCardRow">
                      <div className="ttCompareCardLabel">Evidence Snippets + Notes</div>
                      <div className="ttCompareCardValue ttCompareCheck">&#10003;</div>
                    </div>
                    <div className="ttCompareCardRow">
                      <div className="ttCompareCardLabel">Priority Queue</div>
                      <div className="ttCompareCardValue ttCompareX">&times;</div>
                    </div>
                    <div className="ttCompareCardRow ttCompareCardRowFooter">
                      <div className="ttCompareCardLabel">Best Fit</div>
                      <div className="ttCompareCardValue">Ongoing Team Workflows</div>
                    </div>
                  </div>
                </div>

                <div className="ttCompareCard">
                  <div className="ttCompareCardHead">
                    <div className="ttCompareCardPlan">PRO LIFETIME PASS</div>
                  </div>
                  <div className="ttCompareCardRows">
                    <div className="ttCompareCardRow">
                      <div className="ttCompareCardLabel">Extraction Allowance</div>
                      <div className="ttCompareCardValue ttCompareAccent">5000 / year</div>
                    </div>
                    <div className="ttCompareCardRow">
                      <div className="ttCompareCardLabel">Max Files / Extraction</div>
                      <div className="ttCompareCardValue">3</div>
                    </div>
                    <div className="ttCompareCardRow">
                      <div className="ttCompareCardLabel">Max File Size</div>
                      <div className="ttCompareCardValue">20MB</div>
                    </div>
                    <div className="ttCompareCardRow">
                      <div className="ttCompareCardLabel">Evidence Snippets + Notes</div>
                      <div className="ttCompareCardValue ttCompareCheck">&#10003;</div>
                    </div>
                    <div className="ttCompareCardRow">
                      <div className="ttCompareCardLabel">Priority Queue</div>
                      <div className="ttCompareCardValue ttCompareCheck">&#10003;</div>
                    </div>
                    <div className="ttCompareCardRow ttCompareCardRowFooter">
                      <div className="ttCompareCardLabel">Best Fit</div>
                      <div className="ttCompareCardValue">Long-Run Operations</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="ttCompareTableWrap">
                <table className="ttCompareTable">
                  <thead>
                    <tr>
                      <th className="ttCompareColLabel">Plans</th>
                      <th className="ttCompareColPlan">PRO 30-DAY PASS</th>
                      <th className="ttCompareColPlan">PRO ANNUAL PASS</th>
                      <th className="ttCompareColPlan">PRO LIFETIME PASS</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="ttCompareRowLabel">Extraction Allowance</td>
                      <td className="ttCompareAccent">300 / 30 days</td>
                      <td className="ttCompareAccent">1500 / 365 days</td>
                      <td className="ttCompareAccent">5000 / year</td>
                    </tr>
                    <tr>
                      <td className="ttCompareRowLabel">Max Files / Extraction</td>
                      <td className="ttCompareCenter">3</td>
                      <td className="ttCompareCenter">3</td>
                      <td className="ttCompareCenter">3</td>
                    </tr>
                    <tr>
                      <td className="ttCompareRowLabel">Max File Size</td>
                      <td className="ttCompareCenter">10MB</td>
                      <td className="ttCompareCenter">20MB</td>
                      <td className="ttCompareCenter">20MB</td>
                    </tr>
                    <tr>
                      <td className="ttCompareRowLabel">Evidence Snippets + Notes</td>
                      <td className="ttCompareCenter ttCompareCheck">&#10003;</td>
                      <td className="ttCompareCenter ttCompareCheck">&#10003;</td>
                      <td className="ttCompareCenter ttCompareCheck">&#10003;</td>
                    </tr>
                    <tr>
                      <td className="ttCompareRowLabel">Priority Queue</td>
                      <td className="ttCompareCenter ttCompareX">&times;</td>
                      <td className="ttCompareCenter ttCompareX">&times;</td>
                      <td className="ttCompareCenter ttCompareCheck">&#10003;</td>
                    </tr>
                    <tr className="ttCompareRowFooter">
                      <td className="ttCompareRowLabel">Best Fit</td>
                      <td className="ttCompareCenter">Short-Term Review Cycles</td>
                      <td className="ttCompareCenter">Ongoing Team Workflows</td>
                      <td className="ttCompareCenter">Long-Run Operations</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </section>

      <section className="card" ref={resultsRef}>
        <h2>Per-file status</h2>
        {!reports.length && <p className="muted">No extraction run yet.</p>}
        {!!reports.length && (
          <ul className="statusList">
            {reports.map((r, idx) => (
              <li key={`${r.source}-${idx}`} className={r.ok ? "ok" : "bad"}>
                <strong>{r.source}</strong> - {r.ok ? `OK (${r.chars ?? 0} chars)` : r.error}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="row">
          <h2>Reminder Sheet</h2>
          <div className="actions">
            <button id="download-csv-btn" onClick={downloadCsv} disabled={!items.length}>
              Download CSV
            </button>
            <button onClick={downloadTxt} disabled={!items.length}>
              Download TXT
            </button>
          </div>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Date</th>
                <th>Type</th>
                <th>Source Snippet</th>
                <th>Confidence</th>
                <th>Source</th>
                <th>Location</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {!sortedItems.length && (
                <tr>
                  <td colSpan={8} className="muted">
                    No results yet.
                  </td>
                </tr>
              )}
              {cappedResults.map((i) => (
                <tr key={i.id}>
                  <td>{i.item}</td>
                  <td>{i.date || "null"}</td>
                  <td>{i.type}</td>
                  <td>{i.snippet}</td>
                  <td>{i.confidence}</td>
                  <td>{i.source}</td>
                  <td>{i.location || ""}</td>
                  <td>{i.notes || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasExpandableResults && (
          <div className="resultsAccordionWrap">
            <button
              type="button"
              className="resultsAccordionToggle"
              onClick={() => setShowAllResults((prev) => !prev)}
              aria-expanded={showAllResults}
            >
              <span className="resultsAccordionSign">{showAllResults ? "-" : "+"}</span>
              <span className="resultsAccordionText">
                {showAllResults ? "Collapse to Hide All Results" : "Expand to Show All Results"}
              </span>
            </button>
          </div>
        )}
        {showAllResults && hasOverflowBeyondCap && (
          <a className="resultsCsvLimit" href="#download-csv-btn">
            You Must Download CSV to View All
          </a>
        )}
      </section>

        <p className="disclaimer">Informational extraction only. Not legal advice.</p>
        <section id="use-cases" className="useCasesCards">
          <div className="useCasesCardsIntro">
            <h2>Use Cases</h2>
            <p>Who this helps and how teams use deterministic reminder extraction.</p>
          </div>

          <div className="useCasesCardsGrid">
            {USE_CASE_CARDS.map((card) => (
              <article key={card.id} className="useCaseCard">
                <img src={card.image} alt="" className="useCaseCardImage" />
                <div className="useCaseCardBody">
                  <h3>{card.title}</h3>
                  <p>{card.copy}</p>
                  <div className="useCaseCardTags" aria-label={`${card.title} highlights`}>
                    {card.tags.map((tag) => (
                      <span key={tag} className="useCaseCardTag">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="newsletter-wrap" className="newsletterSection">
          <MailerLiteForm />
        </section>

        <section id="legal" className="legal legalPolicies">
          <div className="legalPoliciesIntro">
            <h2>Policies</h2>
            <p className="muted">Legal and policy information for using Deadline & Renewal Extractor.</p>
          </div>
          <div id="terms" className="legal-section">
            <button
              className="legal-header"
              type="button"
              onClick={() => setOpenLegal((prev) => ({ ...prev, terms: !prev.terms }))}
              aria-expanded={openLegal.terms}
            >
              <span className="legal-toggle">{openLegal.terms ? "-" : "+"}</span>
              <h3>Terms of Service</h3>
            </button>
            {openLegal.terms && (
              <div className="legal-content">
                <p>
                  Deadline & Renewal Extractor provides informational, deterministic extraction of date-related
                  obligations from uploaded documents and pasted text. The service is designed to help teams identify
                  potential renewal, notice, payment, and term-related deadlines in a structured format.
                </p>
                <p>
                  This product does not provide legal advice, legal interpretation, or compliance certification. Output
                  should be reviewed by your team before operational, contractual, or legal reliance, especially where
                  clause language is ambiguous or business context changes.
                </p>
                <p>
                  You are responsible for ensuring that submitted materials are authorized for processing under your
                  internal policies. Usage limits, feature availability, and access controls may vary by plan and may
                  be updated as the service evolves.
                </p>
              </div>
            )}
          </div>

          <div id="refund" className="legal-section">
            <button
              className="legal-header"
              type="button"
              onClick={() => setOpenLegal((prev) => ({ ...prev, refund: !prev.refund }))}
              aria-expanded={openLegal.refund}
            >
              <span className="legal-toggle">{openLegal.refund ? "-" : "+"}</span>
              <h3>Refund Policy</h3>
            </button>
            {openLegal.refund && (
              <div className="legal-content">
                <p>
                  If you believe you were charged in error or experienced a technical issue that prevented normal use of
                  the service, you may request a refund within 24 hours of purchase.
                </p>
                <p>
                  To request a refund, contact <a href="mailto:support@trusted-tools.com">support@trusted-tools.com</a>{" "}
                  and include the email used at checkout, the date of purchase, and a brief description of the issue.
                </p>
                <p>
                  Approved refunds are processed back to the original payment method. Processing times depend on your
                  payment provider.
                </p>
              </div>
            )}
          </div>

          <div id="privacy" className="legal-section">
            <button
              className="legal-header"
              type="button"
              onClick={() => setOpenLegal((prev) => ({ ...prev, privacy: !prev.privacy }))}
              aria-expanded={openLegal.privacy}
            >
              <span className="legal-toggle">{openLegal.privacy ? "-" : "+"}</span>
              <h3>Privacy Policy</h3>
            </button>
            {openLegal.privacy && (
              <div className="legal-content">
                <p>
                  Uploaded files and pasted text are processed to detect date obligations and generate reminder-sheet
                  output. In this deterministic product flow, extraction uses rule-based logic and does not rely on
                  third-party AI or OCR services.
                </p>
                <p>
                  Operational metadata, such as request timing, file characteristics, and plan usage counters, may be
                  processed to support reliability, abuse prevention, and plan-limit enforcement. We recommend
                  submitting only documents your organization is authorized to process within this tool.
                </p>
                <p>
                  You should avoid sharing confidential or regulated information unless approved by your organization.
                  Privacy and data-handling practices may be refined over time as infrastructure, billing, and account
                  controls are expanded.
                </p>
              </div>
            )}
          </div>
        </section>
      </main>
      <footer className="siteFooter">
        <div className="siteFooterInner">
          <div className="footerCol">
            <p className="footerBrand">Deadline & Renewal Extractor</p>
            <p className="footerNote">
              Deterministic extraction for renewals, notice deadlines, payment due dates, and term/trial endings.
            </p>
            <div className="footerSocials">
              <a href="https://facebook.com" target="_blank" rel="noreferrer" aria-label="Facebook">
                <img src={socialFacebook} alt="" />
              </a>
              <a href="https://x.com" target="_blank" rel="noreferrer" aria-label="X">
                <img src={socialTwitter} alt="" />
              </a>
              <a href="https://tiktok.com" target="_blank" rel="noreferrer" aria-label="TikTok">
                <img src={socialTikTok} alt="" />
              </a>
            </div>
          </div>
          <div className="footerCol footerLinksCol">
            <a href="/">Home</a>
            <a href="#extract">Run Extraction</a>
            <a href="#pricing">Upgrade</a>
            <a href="https://trusted-tools.com/" target="_blank" rel="noreferrer">
              Trusted-Tools
            </a>
          </div>
          <div className="footerCol footerLinksCol">
            <p className="footerPolicyIntro">We aim to meet WCAG 2.1 AA guidelines.</p>
            <a href="#terms">Terms of Service</a>
            <a href="#refund">Refund Policy</a>
            <a href="#privacy">Privacy Policy</a>
          </div>
        </div>
        <div className="footerBottom">Â© 2026 Deadline & Renewal Extractor</div>
      </footer>
    </>
  );
}



