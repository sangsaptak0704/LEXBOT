// Legal tools: document drafter, rights wizard, deadline calculator, compare terms, helplines.
// Everything here runs in the browser; drafts are saved only in this browser.
(() => {
  "use strict";
  const { el } = LB;
  const body = document.getElementById("tool-body");
  const tabs = document.getElementById("tool-tabs");

  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN",
    { day: "numeric", month: "long", year: "numeric" }) : "");
  const money = (v) => (v ? `Rs ${Number(v).toLocaleString("en-IN")}` : "");

  // ===================================================================== drafter
  /*
   * Each template: fields (key, label, type, placeholder/options) and a render(values) that
   * returns the document text. Blank fields show as [Label] so nothing is silently missing.
   */
  const TEMPLATES = {
    notice: {
      title: "Legal notice (demand for payment)",
      blurb: "For money owed to you: a security deposit, unpaid salary, a loan or an unpaid bill.",
      tips: ["Send it by Registered Post with acknowledgement (or speed post) and keep the receipt.",
        "Keep a signed copy. If there is no reply, you can file a case or approach the consumer / labour authority."],
      fields: [
        ["senderName", "Your full name"], ["senderAddress", "Your address", "textarea"],
        ["recipientName", "Name of the person / company"], ["recipientAddress", "Their address", "textarea"],
        ["purpose", "What the money is for", "select", ["refund of my security deposit", "payment of my unpaid salary",
          "repayment of the loan I gave", "payment of the amount due to me", "refund for a service not provided"]],
        ["amount", "Amount due (Rs)", "number"], ["dueDate", "Due since", "date"],
        ["facts", "What happened (short facts)", "textarea",
          "e.g. I vacated the flat at ... on 1 March after paying all rent. You have not returned the deposit despite my reminders on ..."],
        ["days", "Days to pay", "number", "15"],
      ],
      render: (v) => `LEGAL NOTICE

Date: ${fmtDate(today())}

To,
${v.recipientName}
${v.recipientAddress}

Subject: Legal notice for ${v.purpose}

Dear Sir/Madam,

1. I, ${v.senderName}, residing at ${oneLine(v.senderAddress)}, am sending you this notice about the following facts:
   ${v.facts}

2. An amount of ${money(v.amount) || "[Amount]"} is due from you to me since ${fmtDate(v.dueDate) || "[Date]"}, and despite my requests it remains unpaid.

3. I therefore call upon you to pay ${money(v.amount) || "[Amount]"} to me within ${v.days || 15} days of receiving this notice.

4. If you fail to do so, I shall be compelled to take appropriate legal action against you before the competent court / forum, entirely at your risk as to costs and consequences.

5. A copy of this notice has been kept for my records and further action.

Yours faithfully,

${v.senderName}
${oneLine(v.senderAddress)}`,
    },
    cheque: {
      title: "Cheque bounce notice (Section 138, NI Act)",
      blurb: "Demand notice to the person whose cheque was returned unpaid.",
      tips: ["Send this within 30 days of receiving the bank's return memo.",
        "They have 15 days from receiving it to pay. If they don't, you can file a complaint before the Magistrate within one month after those 15 days.",
        "Keep the original cheque, the return memo and the postal receipt."],
      fields: [
        ["senderName", "Your full name (payee)"], ["senderAddress", "Your address", "textarea"],
        ["drawerName", "Name of the person who gave the cheque"], ["drawerAddress", "Their address", "textarea"],
        ["chequeNo", "Cheque number"], ["chequeDate", "Cheque date", "date"], ["amount", "Cheque amount (Rs)", "number"],
        ["bank", "Bank and branch of the cheque"],
        ["memoDate", "Date you received the return memo", "date"],
        ["reason", "Reason given by the bank", "select", ["Funds Insufficient", "Exceeds Arrangement",
          "Account Closed", "Payment Stopped by Drawer", "Signature Differs"]],
        ["purpose", "What the cheque was for", "text", "e.g. repayment of a loan of Rs 50,000 given on 5 January"],
      ],
      check: (v) => {
        if (!v.memoDate) return null;
        const last = addDays(v.memoDate, 30);
        const left = daysBetween(today(), last);
        return left < 0
          ? { bad: true, text: `The 30-day period to send this notice ended on ${fmtDate(last)}. Speak to a lawyer about your options.` }
          : { bad: false, text: `Send this notice by ${fmtDate(last)} (${left} day${left === 1 ? "" : "s"} left).` };
      },
      render: (v) => `LEGAL NOTICE UNDER SECTION 138 OF THE NEGOTIABLE INSTRUMENTS ACT, 1881

Date: ${fmtDate(today())}

To,
${v.drawerName}
${v.drawerAddress}

Subject: Demand for payment of dishonoured cheque no. ${v.chequeNo}

Dear Sir/Madam,

1. You issued cheque no. ${v.chequeNo} dated ${fmtDate(v.chequeDate) || "[Cheque date]"} for ${money(v.amount) || "[Amount]"}, drawn on ${v.bank}, in my favour towards ${v.purpose}.

2. I presented the cheque for payment, and it was returned unpaid with the remark "${v.reason}". I received the bank's return memo on ${fmtDate(v.memoDate) || "[Memo date]"}.

3. I hereby demand that you pay the cheque amount of ${money(v.amount) || "[Amount]"} to me within 15 days of receiving this notice.

4. If you fail to pay within 15 days, I shall file a criminal complaint against you under Section 138 read with Section 142 of the Negotiable Instruments Act, 1881, and take any other legal action available to me, at your risk as to costs and consequences.

Yours faithfully,

${v.senderName}
${oneLine(v.senderAddress)}`,
    },
    rti: {
      title: "RTI application (RTI Act, 2005)",
      blurb: "Ask a government office for information.",
      tips: ["Fee: Rs 10 for central government offices (by IPO, DD, court-fee stamp or online); states set their own. No fee for BPL applicants (attach proof).",
        "Central government offices: apply online at rtionline.gov.in.",
        "The PIO must reply within 30 days. If not, file a first appeal within 30 days after that."],
      fields: [
        ["applicantName", "Your full name"], ["applicantAddress", "Your address", "textarea"], ["phone", "Phone / email"],
        ["authority", "Name of the office / department"], ["authorityAddress", "Office address", "textarea"],
        ["info", "Information you want (one item per line)", "textarea",
          "e.g.\nCertified copy of the file noting on my pension application no. 123\nThe current status of that application"],
        ["period", "Period the information relates to", "text", "e.g. 1 January 2025 to date"],
        ["fee", "Fee", "select", ["Application fee of Rs 10 is enclosed by Indian Postal Order / Demand Draft no. ______",
          "Application fee of Rs 10 has been paid online", "I belong to the Below Poverty Line category; a copy of my BPL certificate is attached, so no fee is payable"]],
      ],
      render: (v) => `APPLICATION UNDER SECTION 6(1) OF THE RIGHT TO INFORMATION ACT, 2005

Date: ${fmtDate(today())}

To,
The Public Information Officer
${v.authority}
${v.authorityAddress}

Subject: Request for information under the RTI Act, 2005

Sir/Madam,

1. Particulars of the information required:
${(v.info || "[Information required]").split("\n").filter(Boolean).map((l, i) => `   (${String.fromCharCode(97 + i)}) ${l.trim()}`).join("\n")}

2. Period to which the information relates: ${v.period}

3. ${v.fee}.

4. I am a citizen of India. Please provide the information within 30 days, as required by Section 7(1) of the Act. If any part of this request concerns another public authority, please transfer it under Section 6(3).

Yours faithfully,

${v.applicantName}
${oneLine(v.applicantAddress)}
${v.phone}`,
    },
    consumer: {
      title: "Consumer complaint (District Commission)",
      blurb: "For a faulty product or poor service you paid for.",
      tips: ["File online at edaakhil.nic.in or at the District Consumer Commission where you live or work.",
        "File within 2 years. Attach copies of the bill, warranty, photos and your messages with the seller.",
        "Try the National Consumer Helpline (1915) first: it is free and often settles complaints quickly."],
      fields: [
        ["name", "Your full name (complainant)"], ["address", "Your address", "textarea"],
        ["opName", "Seller / company (opposite party)"], ["opAddress", "Their address", "textarea"],
        ["district", "Your district"], ["item", "Product or service"],
        ["buyDate", "Date of purchase", "date"], ["paid", "Amount paid (Rs)", "number"],
        ["problem", "What went wrong", "textarea", "e.g. The refrigerator stopped cooling within 20 days. The service centre visited twice but did not repair it."],
        ["steps", "What you did to resolve it", "textarea", "e.g. Complaint no. 4567 on 10 March; email to customer care on 15 March; no response."],
        ["relief", "What you want", "select", ["a full refund of the amount paid", "a replacement with a new product",
          "repair of the product free of charge"]],
        ["compensation", "Compensation for harassment (Rs)", "number", "10000"],
      ],
      render: (v) => `BEFORE THE DISTRICT CONSUMER DISPUTES REDRESSAL COMMISSION, ${(v.district || "[DISTRICT]").toUpperCase()}

Complaint under Section 35 of the Consumer Protection Act, 2019

${v.name}, residing at ${oneLine(v.address)}
                                                    ... Complainant
Versus

${v.opName}, ${oneLine(v.opAddress)}
                                                    ... Opposite Party

1. On ${fmtDate(v.buyDate) || "[Date]"}, the Complainant bought ${v.item} from the Opposite Party and paid ${money(v.paid) || "[Amount]"}. A copy of the bill is attached.

2. ${v.problem}

3. ${v.steps}

4. This amounts to a defect in goods / deficiency in service and an unfair trade practice by the Opposite Party.

5. The cause of action arose on ${fmtDate(v.buyDate) || "[Date]"} and continues. The complaint is within the limitation period of two years, and the value of goods paid for is within this Commission's jurisdiction.

PRAYER
The Complainant requests this Commission to direct the Opposite Party to:
   (a) provide ${v.relief};
   (b) pay ${money(v.compensation) || "[Amount]"} as compensation for mental agony and harassment;
   (c) pay the cost of this complaint;
and pass any other order it thinks fit.

Place: ${v.district}
Date: ${fmtDate(today())}

${v.name}
Complainant

Documents attached: bill / invoice, warranty card, photos, correspondence with the Opposite Party.`,
    },
    fir: {
      title: "Complaint for FIR (to the police)",
      blurb: "A written complaint to the Station House Officer asking them to register an FIR.",
      tips: ["You are entitled to a free copy of the FIR. Note its number.",
        "If the police refuse, send this complaint by post to the Superintendent of Police (Section 173(4) BNSS).",
        "For online fraud, also report at cybercrime.gov.in or call 1930 straight away."],
      fields: [
        ["name", "Your full name"], ["address", "Your address", "textarea"], ["phone", "Phone number"],
        ["station", "Police station"], ["date", "Date of incident", "date"], ["time", "Time (approx.)", "text", "e.g. 9:30 pm"],
        ["place", "Place of incident"],
        ["what", "What happened", "textarea", "Describe events in order: who, what, when, where, how."],
        ["accused", "Person(s) responsible, if known", "textarea", "Name, address, description - or 'unknown'"],
        ["loss", "Property lost / injuries", "textarea", "e.g. Mobile phone (Samsung, IMEI ...), Rs 5,000 cash"],
        ["witnesses", "Witnesses, if any", "text"],
      ],
      render: (v) => `To,
The Station House Officer
${v.station} Police Station

Date: ${fmtDate(today())}

Subject: Complaint for registration of an FIR under Section 173 of the Bharatiya Nagarik Suraksha Sanhita, 2023

Sir/Madam,

I, ${v.name}, residing at ${oneLine(v.address)} (phone: ${v.phone}), wish to report the following:

1. Date and time: ${fmtDate(v.date) || "[Date]"}, around ${v.time}
2. Place: ${v.place}
3. What happened:
   ${v.what}
4. Person(s) responsible: ${v.accused}
5. Property lost / injuries: ${v.loss}
6. Witnesses: ${v.witnesses || "None known"}

I request you to register an FIR, investigate the matter and take action according to law, and to give me a free copy of the FIR.

I declare that the above information is true to the best of my knowledge.

Yours faithfully,

${v.name}`,
    },
  };

  const oneLine = (s) => (s || "").replace(/\s*\n\s*/g, ", ");
  const addDays = (iso, n) => {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const addMonths = (iso, n) => {
    const d = new Date(`${iso}T00:00:00`);
    d.setMonth(d.getMonth() + n);
    return d.toISOString().slice(0, 10);
  };
  const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);

  function draftKey(id) { return LB.userKey(`draft_${id}`); }

  function showDrafter(id) {
    const tpl = TEMPLATES[id] || TEMPLATES.notice;
    id = TEMPLATES[id] ? id : "notice";
    let values = {};
    try { values = JSON.parse(localStorage.getItem(draftKey(id)) || "{}"); } catch { values = {}; }

    const picker = el("div", { class: "doc-picker" }, Object.entries(TEMPLATES).map(([key, t]) =>
      el("a", { class: `doc-card${key === id ? " active" : ""}`, href: `#tools/draft/${key}` },
        el("strong", {}, t.title), el("span", {}, t.blurb))));

    const preview = el("pre", { class: "doc-paper", id: "doc-paper" });
    const notice = el("p", { class: "doc-check", hidden: true });

    const filled = () => {
      const v = {};
      for (const [key, label] of tpl.fields) {
        const raw = (values[key] || "").trim();
        v[key] = raw || `[${label}]`;
      }
      for (const [key, , type] of tpl.fields) if (["date", "number"].includes(type)) v[key] = (values[key] || "").trim();
      return v;
    };
    const update = () => {
      preview.textContent = tpl.render(filled());
      const c = tpl.check && tpl.check(values);
      notice.hidden = !c;
      if (c) { notice.textContent = c.text; notice.classList.toggle("bad", c.bad); }
      try { localStorage.setItem(draftKey(id), JSON.stringify(values)); } catch { /* not saved */ }
    };

    const form = el("form", { class: "doc-form", autocomplete: "on" }, tpl.fields.map(([key, label, type, extra]) => {
      let input;
      if (type === "textarea") input = el("textarea", { rows: key.toLowerCase().includes("address") ? 2 : 4, placeholder: extra || "" });
      else if (type === "select") input = el("select", {}, extra.map((o) => el("option", { value: o }, o)));
      else input = el("input", { type: type || "text", placeholder: type ? (extra || "") : (extra || "") });
      if (type === "number" && extra && !values[key]) values[key] = extra;
      if (type === "select" && !values[key]) values[key] = extra[0];
      input.value = values[key] || "";
      input.addEventListener("input", () => { values[key] = input.value; update(); });
      return el("label", { class: "doc-field" }, el("span", {}, label), input);
    }));

    const copyBtn = el("button", { type: "button" }, "Copy text");
    copyBtn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(preview.textContent); copyBtn.textContent = "Copied"; }
      catch { copyBtn.textContent = "Copy failed"; }
      setTimeout(() => { copyBtn.textContent = "Copy text"; }, 1500);
    });
    const dlBtn = el("button", { type: "button", class: "secondary" }, "Download .txt");
    dlBtn.addEventListener("click", () => {
      const blob = new Blob([preview.textContent], { type: "text/plain;charset=utf-8" });
      const a = el("a", { href: URL.createObjectURL(blob), download: `${id}-draft.txt` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    const printBtn = el("button", { type: "button", class: "secondary" }, "Print / Save as PDF");
    printBtn.addEventListener("click", () => {
      document.body.classList.add("print-doc");
      window.print();
    });
    const clearBtn = el("button", { type: "button", class: "secondary danger" }, "Clear");
    clearBtn.addEventListener("click", () => {
      if (!confirm("Clear everything you typed in this document?")) return;
      localStorage.removeItem(draftKey(id));
      showDrafter(id);
    });

    body.replaceChildren(
      picker,
      el("div", { class: "doc-layout" },
        el("div", { class: "doc-side card" },
          el("h2", {}, tpl.title),
          el("p", { class: "muted small" }, "Fill in the details; the document updates as you type. Saved in this browser only."),
          form),
        el("div", { class: "doc-main" },
          notice,
          el("div", { class: "doc-actions" }, copyBtn, dlBtn, printBtn, clearBtn),
          preview,
          el("div", { class: "doc-tips card" }, el("h3", {}, "Before you send it"),
            el("ul", {}, tpl.tips.map((t) => el("li", {}, t)))),
          el("p", { class: "muted small" },
            "This is a template to help you get started, not legal advice. Have a lawyer check it for anything important."))));
    update();
  }
  window.addEventListener("afterprint", () => document.body.classList.remove("print-doc"));

  // ===================================================================== wizard
  const WIZARD = [
    { area: "Home & rent", icon: "M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6", items: [
      ["My landlord won't return my security deposit", "My landlord won't return my security deposit", "notice"],
      ["I'm being evicted", "My landlord is evicting me, what should I do?"],
      ["Problem with my lease or rent", "I have a problem with my lease and rent, what should I do?"]] },
    { area: "Job & salary", icon: "M3 8h18v11H3zM9 8V5h6v3M3 13h18", items: [
      ["My salary hasn't been paid", "My employer hasn't paid my salary", "notice"],
      ["I was fired without notice", "I was fired without notice"],
      ["I face harassment at work", "I am facing harassment at work, what should I do?"]] },
    { area: "Shopping & services", icon: "M3 4h2l2.5 11h11L21 7H6.5M9 20h.01M18 20h.01", items: [
      ["I bought a faulty product", "I bought a defective product and want a refund, what should I do?", "consumer"],
      ["I want to complain to a consumer court", "How to file a complaint in consumer court", "consumer"]] },
    { area: "Police & crime", icon: "M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z", items: [
      ["I want to report a crime (FIR)", "How to file an FIR", "fir"],
      ["The police won't register my FIR", "Police refused to register my FIR", "fir"],
      ["Someone I know was arrested", "I was arrested, what are my rights?"],
      ["I was cheated online", "I was cheated in an online fraud, what should I do?", "fir"]] },
    { area: "Money & cheques", icon: "M3 7h18v10H3zM12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0M6 10v4M18 10v4", items: [
      ["A cheque given to me bounced", "My cheque bounced, what should I do?", "cheque"],
      ["Someone owes me money", "Someone owes me money and won't pay, what can I do?", "notice"]] },
    { area: "Family", icon: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 3-5 6-5s6 2 6 5M14 15.5c.6-.3 1.3-.5 2-.5 3 0 6 2 6 5", items: [
      ["I want a divorce", "How to file for divorce"],
      ["I'm facing violence at home", "My partner threatened to hurt me"],
      ["Dowry is being demanded", "My in-laws are demanding dowry, what can I do?"]] },
    { area: "Government & rights", icon: "M3 9l9-5 9 5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18", items: [
      ["I need information from a government office", "How do I file an RTI?", "rti"],
      ["My fundamental rights were violated", "My fundamental rights were violated, what can I do?"]] },
  ];

  function wizIcon(d) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "wiz-icon");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
    return svg;
  }

  function showWizard() {
    const steps = el("ol", { class: "wiz-steps" },
      el("li", { class: "on" }, "Choose an area"), el("li", {}, "Pick your situation"), el("li", {}, "Get guidance"));
    const stage = el("div", { class: "wiz-stage" });
    const setStep = (n) => [...steps.children].forEach((li, i) => li.classList.toggle("on", i <= n));

    const areas = () => {
      setStep(0);
      stage.replaceChildren(el("h2", {}, "What is your problem about?"),
        el("div", { class: "wiz-grid" }, WIZARD.map((a) => {
          const b = el("button", { type: "button", class: "wiz-card" },
            wizIcon(a.icon), el("strong", {}, a.area),
            el("span", { class: "muted small" }, `${a.items.length} situations`));
          b.addEventListener("click", () => situations(a));
          return b;
        })));
    };
    const situations = (a) => {
      setStep(1);
      const back = el("button", { type: "button", class: "link-btn" }, "← All areas");
      back.addEventListener("click", areas);
      stage.replaceChildren(back, el("h2", {}, `${a.area}: which describes you best?`),
        el("div", { class: "wiz-list" }, a.items.map(([label, q, draft]) => {
          const b = el("button", { type: "button", class: "wiz-option" }, label, el("span", { "aria-hidden": "true" }, "›"));
          b.addEventListener("click", () => result(a, label, q, draft));
          return b;
        })));
    };
    const result = (a, label, q, draft) => {
      setStep(2);
      const back = el("button", { type: "button", class: "link-btn" }, `← ${a.area}`);
      back.addEventListener("click", () => situations(a));
      const go = el("button", { type: "button" }, "Get my step-by-step guidance");
      go.addEventListener("click", () => LB.chat.ask(q));
      stage.replaceChildren(back,
        el("div", { class: "wiz-result card" },
          el("span", { class: "eyebrow" }, a.area),
          el("h2", {}, label),
          el("p", {}, "LexBot will reason over its legal knowledge base and give you numbered steps, the terms that matter and reminders about deadlines and evidence."),
          el("div", { class: "wiz-actions" }, go,
            draft ? el("a", { class: "button-link", href: `#tools/draft/${draft}` }, "Draft the document") : null,
            el("a", { class: "button-link", href: "#tools/deadlines" }, "Check deadlines"),
            el("a", { class: "button-link", href: "#tools/help" }, "Find help"))));
    };
    body.replaceChildren(el("div", { class: "wizard" }, steps, stage));
    areas();
  }

  // ================================================================== deadlines
  const DEADLINE_KINDS = {
    cheque: {
      label: "Cheque bounce",
      dateLabel: "Date you received the bank's return memo",
      extra: ["noticeServed", "Date the other person received your notice (optional)"],
      plan: (d, x) => {
        const out = [{ what: "Send the legal demand notice", when: addDays(d, 30), note: "Within 30 days of the return memo (s.138(b) NI Act)" }];
        if (x) {
          out.push({ what: "Their time to pay ends", when: addDays(x, 15), note: "15 days after they receive the notice" });
          out.push({ what: "File the complaint before the Magistrate", when: addMonths(addDays(x, 15), 1), note: "Within 1 month after the 15 days end (s.142)" });
        }
        return out;
      },
    },
    rti: {
      label: "RTI application",
      dateLabel: "Date the PIO received your RTI application",
      plan: (d) => [
        { what: "Reply due from the PIO", when: addDays(d, 30), note: "30 days (48 hours if life or liberty is involved)" },
        { what: "Last day for the first appeal if there's no reply", when: addDays(d, 60), note: "30 days after the reply was due" },
      ],
    },
    consumer: {
      label: "Consumer complaint",
      dateLabel: "Date the problem arose (e.g. defect found, service refused)",
      plan: (d) => [{ what: "File the complaint at the Consumer Commission", when: addMonths(d, 24), note: "Within 2 years (s.69 Consumer Protection Act, 2019)" }],
    },
    money: {
      label: "Recovering money owed",
      dateLabel: "Date the money became due",
      plan: (d) => [{ what: "File a civil suit to recover the money", when: addMonths(d, 36), note: "Generally within 3 years (Limitation Act, 1963); some claims differ" }],
    },
    efir: {
      label: "e-FIR filed online",
      dateLabel: "Date you filed the e-FIR",
      plan: (d) => [{ what: "Sign the e-FIR at the police station", when: addDays(d, 3), note: "Within 3 days (s.173(1) BNSS)" }],
    },
  };

  function showDeadlines() {
    const kind = el("select", { id: "dl-kind" }, Object.entries(DEADLINE_KINDS).map(([k, v]) => el("option", { value: k }, v.label)));
    const date = el("input", { type: "date", id: "dl-date", value: today() });
    const extra = el("input", { type: "date", id: "dl-extra" });
    const dateLbl = el("span", {});
    const extraWrap = el("label", { class: "doc-field" }, el("span", { id: "dl-extra-label" }), extra);
    const out = el("div", { class: "dl-out" });

    const update = () => {
      const k = DEADLINE_KINDS[kind.value];
      dateLbl.textContent = k.dateLabel;
      extraWrap.hidden = !k.extra;
      if (k.extra) extraWrap.querySelector("span").textContent = k.extra[1];
      if (!date.value) { out.replaceChildren(el("p", { class: "muted" }, "Pick a date to see your deadlines.")); return; }
      const rows = k.plan(date.value, extra.value || null).sort((x, y) => x.when.localeCompare(y.when));
      const now = today();
      const span = Math.max(1, daysBetween(date.value, rows[rows.length - 1].when));
      const passedNow = Math.min(100, Math.max(0, (daysBetween(date.value, now) / span) * 100));
      out.replaceChildren(
        el("div", { class: "dl-timeline", role: "img", "aria-label": "Timeline of deadlines" },
          el("div", { class: "dl-track" }, el("div", { class: "dl-progress", style: `width:${passedNow}%` })),
          el("div", { class: "dl-marker start", style: "left:0%" }, el("span", {}, fmtDate(date.value))),
          rows.map((r, i) => {
            const pos = Math.min(100, (daysBetween(date.value, r.when) / span) * 100);
            // Alternate label rows so nearby dates don't overlap.
            return el("div", { class: `dl-marker${r.when < now ? " past" : ""}${i % 2 === 0 ? " alt" : ""}`,
              style: `left:${pos}%`, title: r.what },
              el("span", {}, fmtDate(r.when)));
          }),
          passedNow > 0 && passedNow < 100 ? el("div", { class: "dl-today", style: `left:${passedNow}%` }, el("span", {}, "Today")) : null),
        el("table", { class: "rel-table dl-table" },
          el("thead", {}, el("tr", {}, el("th", {}, "What to do"), el("th", {}, "Deadline"), el("th", {}, "Status"), el("th", {}, "Rule"))),
          el("tbody", {}, rows.map((r) => {
            const left = daysBetween(now, r.when);
            const status = left < 0 ? ["late", `Passed ${-left} day${left === -1 ? "" : "s"} ago`]
              : left <= 7 ? ["soon", `${left} day${left === 1 ? "" : "s"} left`] : ["ok", `${left} days left`];
            return el("tr", {}, el("td", {}, r.what), el("td", {}, el("strong", {}, fmtDate(r.when))),
              el("td", {}, el("span", { class: `dl-status ${status[0]}` }, status[0] === "late" ? "! " : status[0] === "soon" ? "• " : "✓ ", status[1])),
              el("td", { class: "muted small" }, r.note));
          }))),
        el("p", { class: "muted small" }, "Deadlines are general rules worked out from the dates you entered. Courts can apply exceptions; check with a lawyer if a deadline is close or has passed."));
    };
    [kind, date, extra].forEach((x) => x.addEventListener("input", update));
    body.replaceChildren(el("div", { class: "card dl-card" },
      el("h2", {}, "Deadline calculator"),
      el("p", { class: "muted" }, "Many legal rights expire if you wait too long. Pick your situation and a date."),
      el("div", { class: "dl-form" },
        el("label", { class: "doc-field" }, el("span", {}, "Situation"), kind),
        el("label", { class: "doc-field" }, dateLbl, date),
        extraWrap),
      out));
    update();
  }

  // ==================================================================== compare
  async function showCompare() {
    const a = el("input", { type: "text", list: "concept-options", placeholder: "e.g. Bail" });
    const b = el("input", { type: "text", list: "concept-options", placeholder: "e.g. Anticipatory Bail" });
    const list = el("datalist", { id: "concept-options" });
    const go = el("button", { type: "submit" }, "Compare");
    const form = el("form", { class: "cmp-form" }, a, el("span", { class: "cmp-vs" }, "vs"), b, go, list);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!a.value.trim() || !b.value.trim()) return;
      LB.chat.ask(`Difference between ${a.value.trim()} and ${b.value.trim()}`);
    });
    const PAIRS = [["Libel", "Slander"], ["Bail", "Anticipatory Bail"], ["Civil Law", "Criminal Law"],
      ["Void Contract", "Voidable Contract"], ["Mediation", "Arbitration"], ["Supreme Court", "High Court"],
      ["Felony", "Misdemeanor"], ["Copyright", "Trademark"]];
    body.replaceChildren(el("div", { class: "card" },
      el("h2", {}, "Compare two legal terms"),
      el("p", { class: "muted" }, "LexBot finds what the two have in common and how they connect in its knowledge base."),
      form,
      el("div", { class: "cmp-pairs" }, el("span", { class: "muted small" }, "Popular:"),
        PAIRS.map(([x, y]) => {
          const chip = el("button", { type: "button", class: "chip" }, `${x} vs ${y}`);
          chip.addEventListener("click", () => LB.chat.ask(`Difference between ${x} and ${y}`));
          return chip;
        }))));
    try {
      const { concepts } = await LB.cached("/api/concepts");
      list.replaceChildren(...concepts.map((c) => el("option", { value: c.label })));
    } catch { /* suggestions are optional */ }
  }

  // ================================================================== helplines
  const HELPLINES = [
    ["112", "Emergency (police, fire, ambulance)", "All-India emergency number, 24x7.", "sos"],
    ["181", "Women Helpline", "Violence, harassment or distress; 24x7.", "sos"],
    ["1098", "Childline", "Children in need of care or protection; 24x7.", "sos"],
    ["1930", "Cyber Crime Helpline", "Report online fraud quickly to help freeze the money.", "", "https://cybercrime.gov.in", "cybercrime.gov.in"],
    ["15100", "NALSA Free Legal Aid", "Free lawyer and legal advice if you are eligible.", "", "https://nalsa.gov.in", "nalsa.gov.in"],
    ["1915", "National Consumer Helpline", "Complaints about products and services.", "", "https://consumerhelpline.gov.in", "consumerhelpline.gov.in"],
    ["14567", "Elderline", "Help for senior citizens.", ""],
  ];
  const PORTALS = [
    ["rtionline.gov.in", "https://rtionline.gov.in", "File RTI applications to central government offices"],
    ["edaakhil.nic.in", "https://edaakhil.nic.in", "File consumer complaints online"],
    ["ecourts.gov.in", "https://ecourts.gov.in", "Check the status of a court case"],
    ["indiacode.nic.in", "https://www.indiacode.nic.in", "Read the official text of Acts and sections"],
  ];

  function showHelp() {
    body.replaceChildren(
      el("div", { class: "help-grid" }, HELPLINES.map(([num, name, desc, kind, url, site]) =>
        el("div", { class: `help-card${kind === "sos" ? " sos" : ""}` },
          el("a", { class: "help-num", href: `tel:${num}` }, num),
          el("strong", {}, name), el("span", { class: "muted small" }, desc),
          url ? el("a", { class: "small", href: url, target: "_blank", rel: "noopener noreferrer" }, site) : null))),
      el("div", { class: "card" }, el("h2", {}, "Official portals"),
        el("ul", { class: "portal-list" }, PORTALS.map(([name, url, desc]) =>
          el("li", {}, el("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, name), el("span", { class: "muted" }, ` - ${desc}`)))),
        el("p", { class: "muted small" }, "For free legal aid near you, contact your District Legal Services Authority (DLSA) through nalsa.gov.in.")));
  }

  // ===================================================================== router
  const SHOW = { draft: showDrafter, wizard: showWizard, deadlines: showDeadlines, compare: showCompare, help: showHelp };

  LB.tools = {
    show(arg) {
      const parts = (location.hash.replace(/^#/, "").split("/"));
      const tool = SHOW[arg] ? arg : "draft";
      tabs.querySelectorAll("a").forEach((a) => {
        const on = a.dataset.tool === tool;
        a.classList.toggle("active", on);
        if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
      });
      SHOW[tool](parts[2] ? decodeURIComponent(parts[2]) : undefined);
    },
  };
})();
