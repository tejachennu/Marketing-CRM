import React from "react";
import Link from "next/link";

export const metadata = {
  title: "Terms and Conditions | WAMA by Magnetora AI",
  description: "Terms of Service and WhatsApp Business Solution Provider Agreement for Magnetora AI.",
};

export default function TermsOfServicePage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-800 py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto bg-white p-8 sm:p-12 rounded-2xl shadow-sm border border-slate-200 space-y-10">
        
        {/* Header */}
        <header className="border-b border-slate-200 pb-8">
          <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">
            Legal Terms
          </span>
          <h1 className="mt-4 text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            Terms and Conditions
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Last Updated: September 21, 2026 | Effective Immediately
          </p>
        </header>

        {/* Intro */}
        <section className="space-y-4 text-slate-700 leading-relaxed">
          <p>
            These Terms and Conditions (&quot;Terms,&quot; &quot;Agreement&quot;) constitute a legally binding agreement made between you, whether personally or on behalf of an entity (&quot;Client,&quot; &quot;you,&quot; or &quot;User&quot;), and <strong>Magnetora AI</strong> (&quot;Company,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), concerning your access to and use of the Magnetora AI software platform, CRM dashboards, messaging tools, and WhatsApp integration systems.
          </p>
          <p>
            By registering for an account, accessing the CRM, or authorizing WhatsApp Embedded Signup, you confirm that you have read, understood, and agreed to be bound by all of these Terms.
          </p>
        </section>

        {/* Section 1 */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            1. Scope of Service & Role as Tech Provider
          </h2>
          <p className="text-slate-700 leading-relaxed">
            Magnetora AI operates as a <strong>WhatsApp Technology Provider (TP)</strong>. We provide software applications that allow you to connect your owned WhatsApp Business Accounts (WABA) and phone numbers to our CRM to conduct customer communication, dispatch automated notifications, and organize marketing workflows.
          </p>
          <p className="text-slate-700 leading-relaxed">
            Magnetora AI does not supply phone numbers or sell WhatsApp access lines. You bring your own phone numbers and link them via Meta&apos;s official Embedded Signup flow.
          </p>
        </section>

        {/* Section 2 */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            2. Mandatory Compliance with Meta & WhatsApp Policies
          </h2>
          <p className="text-slate-700 leading-relaxed">
            Your use of the WhatsApp integration within Magnetora AI is strictly conditioned upon your compliance with Meta Platforms, Inc.&apos;s governing terms:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li>
              <strong>WhatsApp Business Terms of Service:</strong> Available at <code>whatsapp.com/legal/business-terms</code>.
            </li>
            <li>
              <strong>WhatsApp Business Messaging Policy:</strong> Available at <code>whatsapp.com/legal/business-policy</code>.
            </li>
            <li>
              <strong>WhatsApp Commerce Policy:</strong> Available at <code>whatsapp.com/legal/commerce-policy</code>.
            </li>
          </ul>
          <div className="bg-rose-50 border-l-4 border-rose-500 p-4 text-rose-900 text-sm mt-3 space-y-2">
            <p className="font-semibold">Zero Tolerance for Spam & Unsolicited Messaging:</p>
            <p>
              You must maintain demonstrable opt-in records for every recipient prior to sending non-service WhatsApp messages. You must honor all opt-out keywords (e.g., &quot;STOP&quot;, &quot;CANCEL&quot;, &quot;UNSUBSCRIBE&quot;) immediately. Transmission of adult content, gambling, predatory lending, alcohol/tobacco promotions, or counterfeit goods is strictly prohibited.
            </p>
          </div>
        </section>

        {/* Section 3 */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            3. Client Responsibilities & WABA Management
          </h2>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li>
              <strong>Business Verification:</strong> You are responsible for completing and maintaining Meta Business Verification for your Meta Business Portfolio.
            </li>
            <li>
              <strong>Payment for Meta Conversation Fees:</strong> Meta charges conversation fees for utility, marketing, service, and authentication conversations. You are responsible for maintaining a valid payment method directly linked to your WABA inside Meta Business Manager.
            </li>
            <li>
              <strong>Template Approvals:</strong> All marketing and proactive notifications must be submitted via Magnetora AI to Meta for template approval prior to broadcast.
            </li>
          </ul>
        </section>

        {/* Section 4 */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            4. Suspension & Account Termination
          </h2>
          <p className="text-slate-700 leading-relaxed">
            We reserve the right to immediately throttle, suspend, or terminate your Magnetora AI workspace without liability if:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li>Your WhatsApp phone number quality rating drops to <strong>&quot;Low&quot;</strong> or is flagged by Meta for high spam complaint rates.</li>
            <li>Meta restricts, disables, or bans your WABA or connected business portfolio.</li>
            <li>You violate any intellectual property, anti-spam, or data protection laws.</li>
            <li>You fail to satisfy subscription fee obligations after notice.</li>
          </ul>
        </section>

        {/* Section 5 */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            5. Disclaimers & Limitation of Liability
          </h2>
          <p className="text-slate-700 leading-relaxed">
            The platform is provided &quot;AS IS&quot; and &quot;AS AVAILABLE.&quot; Magnetora AI is an independent software vendor and is not affiliated, endorsed, or sponsored by Meta Platforms, Inc.
          </p>
          <p className="text-slate-700 leading-relaxed">
            In no event shall Magnetora AI be liable for indirect, incidental, punitive, or consequential damages, including loss of business revenue, lost profits, or data corruption resulting from:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-slate-700">
            <li>WhatsApp Cloud API outages, downtime, or webhook delivery latency on Meta&apos;s servers.</li>
            <li>Template rejections or telephone number blocks enforced by Meta.</li>
            <li>Client&apos;s failure to obtain lawful end-user consent.</li>
          </ul>
        </section>

        {/* Section 6 */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            6. Governing Law & Dispute Resolution
          </h2>
          <p className="text-slate-700 leading-relaxed">
            These Terms shall be governed by and construed in accordance with the laws of the jurisdiction of Company incorporation, without regard to conflict of law principles. Any dispute arising under these Terms shall be resolved through binding arbitration or competent courts located in the Company&apos;s registered city.
          </p>
        </section>

        {/* Section 7 */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            7. Contact Information
          </h2>
          <p className="text-slate-700 leading-relaxed">
            For contractual inquiries, legal notices, or terms clarification, contact:
          </p>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-sm text-slate-700 space-y-2">
            <p><strong>Legal Office:</strong> Magnetora AI Legal Department</p>
            <p><strong>Email:</strong> legal@magnetora.ai</p>
            <p><strong>Support Desk:</strong> support@magnetora.ai</p>
          </div>
        </section>
      </div>
    </main>
  );
}
