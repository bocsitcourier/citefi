import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Citefi",
  description: "How Citefi collects, uses, and protects your information.",
};

const EFFECTIVE_DATE = "June 23, 2026";
const ADDRESS = "3 Cabot Pl, Stoughton, MA 02072";
const EMAIL = "info@citefi.co";
const ENTITY = "Citefi";

export default function PrivacyPage() {
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
          <h1 className="text-4xl font-bold text-slate-900 mb-3">Privacy Policy</h1>
          <p className="text-slate-500 text-sm">
            <strong>Effective Date:</strong> {EFFECTIVE_DATE} &nbsp;·&nbsp;{" "}
            <strong>Last Updated:</strong> {EFFECTIVE_DATE}
          </p>
        </div>

        <div className="prose prose-slate max-w-none space-y-10 text-slate-700 leading-relaxed">

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">1. Introduction</h2>
            <p>
              This Privacy Policy explains how {ENTITY} ("<strong>Citefi</strong>," "<strong>we</strong>," "<strong>us</strong>," or "<strong>our</strong>") collects, uses, discloses, and protects information in connection with the Citefi platform, websites, and related services (collectively, the "<strong>Services</strong>"). Citefi provides an AI-assisted content generation, optimization, and publishing platform for businesses and marketing agencies.
            </p>
            <p className="mt-3">
              By accessing or using the Services, you acknowledge that you have read and understood this Privacy Policy. If you do not agree, please do not use the Services.
            </p>
            <p className="mt-3">
              This Policy works alongside our Terms of Use and, for business customers, any Data Processing Addendum ("<strong>DPA</strong>") we enter into with you.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">2. Who This Policy Covers and Our Roles</h2>
            <p>The Services are designed for business use. We interact with two main categories of individuals, and our role differs for each:</p>
            <ul className="list-disc pl-6 mt-3 space-y-3">
              <li>
                <strong>Customers and their personnel</strong> — the businesses and agencies that subscribe to the Services, and the individual users who access an account ("<strong>Customers</strong>" and "<strong>Authorized Users</strong>"). For information about these individuals and accounts (registration, billing, usage), <strong>Citefi acts as a controller</strong> (or, under U.S. state laws, a "business").
              </li>
              <li>
                <strong>Data subjects within Customer Content</strong> — individuals whose personal information appears in the content, reviews, datasets, or connected accounts that a Customer uploads, connects, or instructs us to process ("<strong>End Data Subjects</strong>"). For this information, <strong>Citefi acts as a processor / "service provider,"</strong> processing it only on the Customer's behalf and under the Customer's instructions. <strong>The Customer is the controller of that information.</strong> If you are an End Data Subject and wish to exercise rights over your personal information, please contact the relevant Customer directly. See Section 11.
              </li>
            </ul>
            <p className="mt-3">For agency Customers using the Services on behalf of their own clients, the agency (or its client) is the controller, and Citefi acts as a processor or sub-processor accordingly.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">3. Information We Collect</h2>
            <div className="space-y-4">
              <div>
                <p><strong>a) Account and Profile Information.</strong> Name, business name, email address, username, password (hashed), role, and similar details you provide when registering or managing an account.</p>
              </div>
              <div>
                <p><strong>b) Payment Information.</strong> Subscription and billing details. <strong>Payments are processed by Stripe, Inc.</strong> We do not store full payment card numbers on our systems; Stripe collects and processes card data under its own privacy policy. We may receive limited billing metadata (e.g., plan, transaction status, last four digits, billing contact).</p>
              </div>
              <div>
                <p><strong>c) Customer Content and Connected Data.</strong> The materials you provide to or connect with the Services, including:</p>
                <ul className="list-disc pl-6 mt-2 space-y-1">
                  <li>Content you upload (e.g., review files via CSV/JSON, documents, datasets, brand guidelines);</li>
                  <li>Data we retrieve on your instruction through connected third-party accounts and APIs;</li>
                  <li>Generated drafts, briefs, and other outputs created through the Services.</li>
                </ul>
                <p className="mt-2">Customer Content may contain personal information about End Data Subjects. We process this information <strong>as a service provider/processor on your behalf</strong>, solely to provide and improve the Services as instructed.</p>
              </div>
              <div>
                <p><strong>d) Connected-Account Credentials and Tokens.</strong> When you connect a third-party service for publishing or data retrieval, we collect and store the credentials, access tokens, or API keys needed to perform the actions you authorize. These are <strong>stored in encrypted form</strong>, used only to perform the Services you direct, and never sold or used for unrelated purposes. You can disconnect an integration or revoke access at any time.</p>
              </div>
              <div>
                <p><strong>e) Usage, Device, and Log Information.</strong> Information about how you interact with the Services, including IP address, browser and device type, pages and features used, actions taken, timestamps, and diagnostic/error logs.</p>
              </div>
              <div>
                <p><strong>f) Publicly Available Monitoring Data.</strong> In providing research features, the Services access publicly available web pages and APIs that you configure. We process only publicly accessible information and do not access login-protected or paywalled sources.</p>
              </div>
              <div>
                <p><strong>g) Communications and Support.</strong> Information you provide when you contact us, request support, respond to surveys, or sign up for communications.</p>
              </div>
              <div>
                <p><strong>h) Cookies and Similar Technologies.</strong> See Section 14.</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">4. How We Use Information</h2>
            <p>We use information to:</p>
            <ul className="list-disc pl-6 mt-3 space-y-1">
              <li>Provide, operate, maintain, and secure the Services;</li>
              <li>Create and manage accounts and authenticate users;</li>
              <li>Process subscriptions, payments, usage metering, and billing;</li>
              <li>Generate, optimize, schedule, and publish content as you direct;</li>
              <li>Provide customer support and respond to inquiries;</li>
              <li>Monitor, troubleshoot, improve, and develop the Services;</li>
              <li>Detect, prevent, and address fraud, abuse, and security incidents;</li>
              <li>Send service-related communications and, where permitted, marketing communications (which you can opt out of); and</li>
              <li>Comply with legal obligations and enforce our agreements.</li>
            </ul>
            <p className="mt-3">We use <strong>Customer Content only to provide the Services</strong> to the relevant Customer. We do not use one Customer's Customer Content to benefit another Customer.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">5. Artificial Intelligence and Automated Content Generation</h2>
            <p>The Services use artificial intelligence and machine-learning models — including third-party large language models (LLMs) — to generate, analyze, and optimize content. As part of providing the Services:</p>
            <ul className="list-disc pl-6 mt-3 space-y-2">
              <li>Customer Content and prompts may be transmitted to and processed by third-party AI providers acting as our <strong>sub-processors</strong> (see Section 6);</li>
              <li>We seek to use AI providers and configurations that <strong>do not train their models on Customer Content</strong>;</li>
              <li><strong>AI-generated output may be inaccurate, incomplete, or unsuitable.</strong> Outputs should be reviewed by a human before use or publication. Citefi does not warrant the accuracy of AI-generated content.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">6. How We Share and Disclose Information</h2>
            <p>We do <strong>not sell</strong> your personal information, and we do not "share" it for cross-context behavioral advertising. We disclose information only as follows:</p>
            <div className="space-y-4 mt-3">
              <div>
                <p><strong>a) Service Providers and Sub-Processors.</strong> We use trusted third parties to help operate the Services, bound by contractual confidentiality and data-protection obligations. Current categories include:</p>
                <ul className="list-disc pl-6 mt-2 space-y-1">
                  <li><strong>Payment processing:</strong> Stripe, Inc.</li>
                  <li><strong>Cloud infrastructure and storage:</strong> Replit, Inc.; Neon Inc.</li>
                  <li><strong>AI / large language model providers:</strong> Leading AI model providers supplying large language models, image generation, and text-to-speech services. We automatically use the latest available model versions from these providers.</li>
                </ul>
              </div>
              <p><strong>b) At Your Direction.</strong> When you connect or instruct us to publish to or retrieve from a third-party service, we share information with that service as needed to perform the action you authorized.</p>
              <p><strong>c) Legal and Safety.</strong> To comply with applicable law, regulation, or governmental request; to enforce our Terms; and to protect the rights, property, or safety of Citefi, our Customers, or others.</p>
              <p><strong>d) Business Transfers.</strong> In connection with a merger, acquisition, or sale of assets, information may be transferred as part of that transaction, subject to this Policy.</p>
              <p><strong>e) With Consent.</strong> For any other purpose disclosed to you with your consent.</p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">7. Data Retention and Deletion</h2>
            <p>We retain personal information for as long as needed to provide the Services, comply with legal obligations, resolve disputes, and enforce our agreements. Upon account termination, or upon a Customer's verified request, we will delete or de-identify Customer Content within a commercially reasonable period, except where retention is required by law.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">8. Security</h2>
            <p>We implement administrative, technical, and physical safeguards designed to protect information, including:</p>
            <ul className="list-disc pl-6 mt-3 space-y-1">
              <li>Encryption of data in transit (TLS) and at rest;</li>
              <li>Storage of connected-account credentials and tokens in encrypted form, scoped per Customer;</li>
              <li>Logical tenant isolation and access controls to separate Customers' data;</li>
              <li>Role-based access, least-privilege principles, and audit logging.</li>
            </ul>
            <p className="mt-3">No method of transmission or storage is completely secure. While we work to protect your information, we cannot guarantee absolute security.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">9. International Data Transfers</h2>
            <p>Citefi is based in the United States and we currently operate and process data in the United States. The Services are presently intended for users in the United States. If you access the Services from outside the United States, you understand that your information will be processed in the United States, where data-protection laws may differ from those of your jurisdiction.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">10. Your U.S. Privacy Rights</h2>
            <p>Depending on your state of residence (including California, Virginia, Colorado, Connecticut, Utah, Texas, and other states with comprehensive privacy laws), you may have rights regarding personal information that we process as a controller/business, including the right to:</p>
            <ul className="list-disc pl-6 mt-3 space-y-1">
              <li>Know or access the personal information we hold about you;</li>
              <li>Correct inaccurate personal information;</li>
              <li>Delete personal information;</li>
              <li>Obtain a portable copy of your information;</li>
              <li>Opt out of the "sale" or "sharing" of personal information (<strong>note: we do not sell or share personal information</strong>); and</li>
              <li>Not receive discriminatory treatment for exercising your rights.</li>
            </ul>
            <p className="mt-3">To exercise these rights, contact us at <a href={`mailto:${EMAIL}`} className="text-primary underline">{EMAIL}</a>. We will verify your request as required by law.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">11. Customer Content and Customer Responsibilities</h2>
            <p>Where Citefi processes personal information on behalf of a Customer, the Customer is responsible for having a valid legal basis and any required consents to provide that information to us. If you are an End Data Subject seeking to access, correct, or delete personal information contained in a Customer's content, please contact the relevant Customer directly.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">12. Children's Privacy</h2>
            <p>The Services are not directed to individuals under the age of 18, and we do not knowingly collect personal information from children. If you believe a child has provided us personal information, contact us at <a href={`mailto:${EMAIL}`} className="text-primary underline">{EMAIL}</a> and we will take appropriate steps to delete it.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">13. Third-Party Services and Links</h2>
            <p>The Services integrate with and may link to third-party services. Those services are governed by their own privacy policies, and we are not responsible for their practices. We encourage you to review them.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">14. Cookies and Similar Technologies</h2>
            <p>We and our providers use cookies and similar technologies to operate and secure the Services, remember preferences, authenticate users, and analyze usage. You can control cookies through your browser settings; disabling some cookies may affect functionality.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">15. Changes to This Privacy Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will post the updated version with a revised "Last Updated" date and, for material changes, provide additional notice (such as by email or in-product notice). Your continued use of the Services after the effective date constitutes acceptance of the updated Policy.</p>
          </section>

          <section className="border-t border-slate-200 pt-8">
            <h2 className="text-xl font-bold text-slate-900 mb-3">16. Contact Us</h2>
            <p>If you have questions about this Privacy Policy or our privacy practices, contact us at:</p>
            <div className="mt-4 p-5 bg-slate-50 border border-slate-200 rounded-md text-sm space-y-1">
              <p className="font-semibold text-slate-900">{ENTITY}</p>
              <p className="text-slate-600">Attn: Privacy</p>
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
            <Link href="/terms" className="hover:text-slate-600 transition-colors">Terms of Use</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
