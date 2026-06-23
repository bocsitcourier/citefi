import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Use — Citefi",
  description: "The terms and conditions governing your use of the Citefi platform.",
};

const EFFECTIVE_DATE = "June 23, 2026";
const ADDRESS = "3 Cabot Pl, Stoughton, MA 02072";
const EMAIL = "info@citefi.co";
const ENTITY = "Citefi";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200 px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <Link href="/">
            <span className="font-bold text-xl text-slate-900 tracking-tight">citefi.co</span>
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-16">
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-slate-900 mb-3">Terms of Use</h1>
          <p className="text-slate-500 text-sm">
            <strong>Effective Date:</strong> {EFFECTIVE_DATE} &nbsp;·&nbsp;{" "}
            <strong>Last Updated:</strong> {EFFECTIVE_DATE}
          </p>
        </div>

        <div className="prose prose-slate max-w-none space-y-10 text-slate-700 leading-relaxed">

          <p>
            These Terms of Use ("<strong>Terms</strong>") are a binding agreement between you and {ENTITY} ("<strong>Citefi</strong>," "<strong>we</strong>," "<strong>us</strong>," or "<strong>our</strong>") governing your access to and use of the Citefi platform, websites, and related services (collectively, the "<strong>Services</strong>"). By accessing or using the Services, creating an account, or clicking to accept, you agree to these Terms. If you do not agree, do not use the Services.
          </p>
          <p>
            If you accept these Terms on behalf of a company or other entity, you represent that you have authority to bind that entity, and "<strong>you</strong>" and "<strong>Customer</strong>" refer to that entity.
          </p>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">1. Eligibility and Accounts</h2>
            <p>The Services are for business use by individuals who are at least 18 years old. You agree to provide accurate registration information and to keep it current. You are responsible for safeguarding your account credentials and for all activity under your account. Notify us promptly at <a href={`mailto:${EMAIL}`} className="text-primary underline">{EMAIL}</a> of any unauthorized use.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">2. Definitions</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>"<strong>Customer Content</strong>" means content, data, files, reviews, prompts, instructions, and other materials you upload, connect, generate, or otherwise provide to or through the Services.</li>
              <li>"<strong>Output</strong>" means content generated for you by the Services, including AI-generated drafts, briefs, and assets.</li>
              <li>"<strong>Connected Account</strong>" means any third-party service you connect to the Services (e.g., a CMS, social, analytics, or data source).</li>
              <li>"<strong>Authorized User</strong>" means an individual you permit to use the Services under your account.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">3. The Services</h2>
            <p>Citefi provides an AI-assisted platform for generating, optimizing, scheduling, analyzing, and publishing content, and for related research and monitoring features. We may modify, improve, add, or discontinue features over time. We will not materially decrease the core functionality of a paid plan during a paid term without notice.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">4. Subscriptions, Fees, and Billing</h2>
            <div className="space-y-4">
              <p><strong>a) Plans and Fees.</strong> Access to paid features requires a subscription. Fees, plan inclusions, usage allowances, and any usage-based or metered components are described at the point of purchase or on our pricing page.</p>
              <p><strong>b) Payment Processor.</strong> Payments are processed by <strong>Stripe</strong>. By providing payment information, you authorize us and Stripe to charge the applicable fees and any taxes. You agree to Stripe's terms as part of payment processing.</p>
              <p><strong>c) Usage-Based Charges.</strong> Where the Services include metered or usage-based components, you authorize charges for usage above included allowances at the rates disclosed to you. Subject to applicable law, charges for usage already consumed are non-refundable.</p>
              <p><strong>d) Renewals.</strong> Subscriptions automatically renew for successive periods unless cancelled before the renewal date. You can cancel by contacting <a href={`mailto:${EMAIL}`} className="text-primary underline">{EMAIL}</a>; cancellation takes effect at the end of the current billing period.</p>
              <p><strong>e) Taxes.</strong> Fees are exclusive of taxes. You are responsible for applicable taxes other than taxes on our net income.</p>
              <p><strong>f) Changes to Fees.</strong> We may change fees and usage rates. For recurring subscriptions, we will provide advance notice and changes apply at the next renewal.</p>
              <p><strong>g) Late or Failed Payments.</strong> We may suspend or limit the Services for non-payment after notice.</p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">5. Acceptable Use</h2>
            <p>You agree not to, and not to permit any Authorized User or third party to:</p>
            <ul className="list-disc pl-6 mt-3 space-y-2">
              <li>Use the Services in violation of any applicable law or regulation;</li>
              <li>Upload, generate, publish, or distribute content that is unlawful, infringing, defamatory, harassing, hateful, deceptive, or harmful;</li>
              <li>Use the Services to generate spam, malware, or content intended to deceive or defraud;</li>
              <li>Provide or process personal information without a valid legal basis and any required consents or notices;</li>
              <li>Circumvent any login, CAPTCHA, rate limit, or technical access control, or scrape data in violation of a third party's terms of service;</li>
              <li>Reverse engineer, decompile, or attempt to derive source code of the Services;</li>
              <li>Resell, sublicense, or provide the Services to third parties except as expressly permitted;</li>
              <li>Interfere with or disrupt the integrity or performance of the Services;</li>
              <li>Use the Services to build a competing product, or to train a competing AI model; or</li>
              <li>Exceed rate limits or use the Services in a manner that imposes an unreasonable load.</li>
            </ul>
            <p className="mt-3">We may investigate and take appropriate action for violations, including suspending or terminating access.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">6. Customer Content and Your Warranties</h2>
            <div className="space-y-4">
              <p><strong>a) Ownership.</strong> As between you and Citefi, you own your Customer Content. You grant Citefi a worldwide, non-exclusive license to host, process, transmit, display, and otherwise use Customer Content <strong>solely to provide, maintain, secure, and improve the Services for you</strong> and as instructed by you.</p>
              <p><strong>b) Your Warranties.</strong> You represent and warrant that you own or have all necessary rights to provide Customer Content; that your Customer Content does not infringe any third party's rights or any applicable law; that for any personal information within Customer Content you have provided all required notices and obtained all required consents; and that you are responsible for the accuracy, quality, and legality of Customer Content.</p>
              <p><strong>c) Data Processing.</strong> Where Citefi processes personal information on your behalf, we act as your service provider/processor as described in our Privacy Policy.</p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">7. Connected Accounts and Publishing Authorization</h2>
            <p>When you connect a Connected Account, you authorize Citefi to access and interact with that account <strong>solely to perform the actions you direct</strong>. You represent that you have the right to grant this access. We store Connected-Account credentials and tokens in encrypted form and use them only to provide the Services. You may revoke access or disconnect an integration at any time. You are responsible for complying with the terms of each Connected Account.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">8. AI-Generated Output</h2>
            <div className="space-y-4">
              <p><strong>a) Ownership of Output.</strong> Subject to your compliance with these Terms and payment of applicable fees, and to the extent Citefi holds any rights in the Output, Citefi assigns to you its right, title, and interest in the Output generated specifically for you. You are responsible for the Output you use or publish.</p>
              <p><strong>b) Nature of AI Output — Important.</strong> The Services use AI models that generate probabilistic results. <strong>Output may be inaccurate, incomplete, outdated, biased, or otherwise unsuitable, and may not be unique to you.</strong> You acknowledge that you must <strong>review and verify Output before relying on or publishing it</strong>; that Citefi does <strong>not warrant</strong> that Output is accurate, original, or non-infringing; and that <strong>you are solely responsible for compliance with any law or platform requirement that applies to AI-generated content</strong>, including any obligation to disclose or label content as AI-generated.</p>
              <p><strong>c) No Professional Advice.</strong> Output is not legal, financial, medical, or other professional advice.</p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">9. Citefi Intellectual Property</h2>
            <p>The Services, including all software, models, designs, text, and other materials provided by us (excluding Customer Content and Output assigned to you), are owned by Citefi or our licensors and are protected by intellectual-property laws. We grant you a limited, non-exclusive, non-transferable, revocable right to access and use the Services during your subscription, subject to these Terms. The Citefi name and logo are our trademarks; you may not use them without permission.</p>
            <p className="mt-3"><strong>Feedback.</strong> If you provide suggestions or feedback, you grant us a perpetual, irrevocable, royalty-free license to use it without restriction or obligation to you.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">10. Aggregated and De-Identified Data</h2>
            <p>We may collect and use aggregated and de-identified data derived from operation of the Services for purposes such as analytics, benchmarking, and improving the Services. We will not use one Customer's identifiable Customer Content to benefit another Customer without instruction or consent.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">11. Agency, White-Label, and Reseller Use</h2>
            <p>If you use the Services to provide content services to your own clients (for example, as an agency or under a white-label arrangement we authorize), you remain responsible for your clients' compliance with these Terms and for all activity in your account. Any reseller or white-label rights beyond ordinary agency use require our written authorization.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">12. Third-Party Services</h2>
            <p>The Services integrate with third-party products and sources (e.g., Stripe, CMS platforms, AI providers). Your use of those services is governed by their terms and policies. We are not responsible for the availability, accuracy, or actions of third-party services.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">13. Confidentiality</h2>
            <p>Each party may access the other's confidential information. The receiving party will use it only to perform under these Terms and will protect it with reasonable care. This does not apply to information that is public, independently developed, or rightfully obtained from another source.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">14. Disclaimer of Warranties</h2>
            <p className="font-medium">
              THE SERVICES AND OUTPUT ARE PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, AND ACCURACY. WE DO NOT WARRANT THAT THE SERVICES WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE, OR THAT OUTPUT WILL BE ACCURATE, ORIGINAL, OR ACHIEVE ANY PARTICULAR RESULT, INCLUDING ANY SEARCH, AI-VISIBILITY, RANKING, OR CITATION OUTCOME. Some jurisdictions do not allow certain warranty exclusions, so some of the above may not apply to you.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">15. Limitation of Liability</h2>
            <p className="font-medium">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW: IN NO EVENT WILL CITEFI BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, REVENUE, DATA, GOODWILL, OR BUSINESS INTERRUPTION, EVEN IF ADVISED OF THE POSSIBILITY. CITEFI'S TOTAL AGGREGATE LIABILITY WILL NOT EXCEED THE GREATER OF (A) THE AMOUNTS YOU PAID TO CITEFI IN THE TWELVE (12) MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM, OR (B) ONE HUNDRED U.S. DOLLARS ($100). These limitations are a fundamental basis of the bargain.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">16. Indemnification</h2>
            <p>You will defend, indemnify, and hold harmless Citefi and its officers, directors, employees, and agents from and against any claims, damages, liabilities, losses, and expenses (including reasonable attorneys' fees) arising out of or related to: (a) your Customer Content; (b) your use of the Services; (c) your violation of these Terms or any law; or (d) for agency/white-label Customers, claims by or relating to your clients.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">17. Term, Suspension, and Termination</h2>
            <p>These Terms apply while you use the Services. You may stop using the Services and cancel at any time. We may suspend or terminate your access (a) for violation of these Terms, (b) to comply with law or protect the Services or others, or (c) for non-payment. Upon termination, your right to use the Services ends; we will, on request and within a reasonable period, make available an export of your Customer Content, after which we may delete it.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">18. Governing Law and Dispute Resolution</h2>
            <p>These Terms are governed by the laws of the Commonwealth of Massachusetts, without regard to conflict-of-laws rules. Any dispute will be brought exclusively in the state or federal courts located in Norfolk County, Massachusetts, and the parties consent to personal jurisdiction there.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">19. Changes to These Terms</h2>
            <p>We may update these Terms from time to time. We will post the updated Terms with a revised "Last Updated" date and, for material changes, provide reasonable notice. Your continued use of the Services after the effective date constitutes acceptance. If you do not agree to the updated Terms, you must stop using the Services.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">20. General</h2>
            <ul className="space-y-2">
              <li><strong>Entire Agreement.</strong> These Terms, the Privacy Policy, and any order form or plan terms constitute the entire agreement between you and Citefi regarding the Services.</li>
              <li><strong>Assignment.</strong> You may not assign these Terms without our consent; we may assign them in connection with a merger, acquisition, or sale of assets.</li>
              <li><strong>Severability.</strong> If any provision is held unenforceable, the remaining provisions remain in effect.</li>
              <li><strong>No Waiver.</strong> Our failure to enforce a provision is not a waiver.</li>
              <li><strong>Force Majeure.</strong> Neither party is liable for delays or failures due to causes beyond its reasonable control.</li>
              <li><strong>Relationship.</strong> The parties are independent contractors; these Terms create no agency, partnership, or joint venture.</li>
            </ul>
          </section>

          <section className="border-t border-slate-200 pt-8">
            <h2 className="text-xl font-bold text-slate-900 mb-3">21. Contact</h2>
            <div className="p-5 bg-slate-50 border border-slate-200 rounded-md text-sm space-y-1">
              <p className="font-semibold text-slate-900">{ENTITY}</p>
              <p className="text-slate-600">{ADDRESS}</p>
              <p>
                <a href={`mailto:${EMAIL}`} className="text-primary underline">{EMAIL}</a>
              </p>
              <p>
                <a href="https://citefi.co" className="text-primary underline">citefi.co</a>
              </p>
            </div>
          </section>

        </div>
      </main>

      <footer className="border-t border-slate-200 px-6 py-8 mt-12">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <span>&copy; {new Date().getFullYear()} Citefi. All rights reserved.</span>
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:text-slate-600 transition-colors">Home</Link>
            <Link href="/privacy" className="hover:text-slate-600 transition-colors">Privacy Policy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
