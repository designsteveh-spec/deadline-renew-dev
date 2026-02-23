import { useEffect } from "react";

const MAILERLITE_ACCOUNT_ID = "1985110";
const MAILERLITE_FORM_TOKEN = "UgUZSa";
const MAILERLITE_UNIVERSAL_SRC = "https://assets.mailerlite.com/js/universal.js";

export default function MailerLiteForm() {
  useEffect(() => {
    if (!(window as any).ml) {
      (window as any).ml = function () {
        ((window as any).ml.q = (window as any).ml.q || []).push(arguments);
      };
    }
    (window as any).ml("account", MAILERLITE_ACCOUNT_ID);

    const hasUniversalScript = Array.from(document.scripts).some((s) => s.src.includes("/js/universal.js"));
    let injectedScript: HTMLScriptElement | null = null;
    if (!hasUniversalScript) {
      injectedScript = document.createElement("script");
      injectedScript.src = MAILERLITE_UNIVERSAL_SRC;
      injectedScript.async = true;
      document.body.appendChild(injectedScript);
    }

    return () => {
      if (injectedScript && injectedScript.parentNode) {
        injectedScript.parentNode.removeChild(injectedScript);
      }
    };
  }, []);

  return (
    <section id="newsletter" className="newsletter">
      <div className="newsletterInner">
        <div className="ml-embedded" data-form={MAILERLITE_FORM_TOKEN} />
      </div>
    </section>
  );
}
