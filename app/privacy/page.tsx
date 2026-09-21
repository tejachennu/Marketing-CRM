import React from "react";
import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | Magnetora AI",
  description: "Comprehensive Privacy Policy and WhatsApp Data Protection Guidelines for Magnetora AI.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-800 py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto bg-white p-8 sm:p-12 rounded-2xl shadow-sm border border-slate-200 space-y-10">
        
        {/* Header */}
        <header className="border-b border-slate-200 pb-8">
          <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">
            Legal Document
          </span>
          <h1 className="mt-4 text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Effective Date: September 21, 2026 | Version 2.4
          </p>
        </header>

        {/* Intro */}
        <section className="space-y-4 text-slate-700 leading-relaxed">
          <p>
            <strong>Magnetora AI</strong> (&quot;Company,&quot; &quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) is committed to protecting your privacy and ensuring the security of your business and customer information. This Privacy Policy details our practices concerning the collection, storage, use, processing, and disclosure of information when you access or use our multi-tenant marketing CRM platform, software suite, websites, and our integrations with third-party application programming interfaces, specifically the <strong>WhatsApp Business Platform</strong> provided by <strong>Meta Platforms, Inc. (&quot;Meta&quot;)</strong>.
          </p>
          <p>
            By accessing or using Magnetora AI, you acknowledge that you have read, understood, and agreed to the practices outlined in this Privacy Policy.
          </p>
        </section>

        {/* Section 1 */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            1. Role of Magnetora AI as a Data Processor & Tech Provider
          </h2>
          <p className="text-slate-700 leading-relaxed">
            In our capacity as a <strong>WhatsApp Technology Provider (TP)</strong> and SaaS CRM provider:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li>
              <strong>Data Controller:</strong> Our business clients (&quot;Clients&quot; or &quot;Subscribers&quot;) act as the Data Controllers of the customer data (end-user telephone numbers, customer contact profiles, communication contents) entered into or transmitted through our platform.
            </li>
            <li>
              <strong>Data Processor / Service Provider:</strong> Magnetora AI acts as a Data Processor processing customer communications strictly on behalf of and according to the instructions of our Clients.
            </li>
          </ul>
        </section>

        {/* Section 2 */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            2. Information We Collect
          </h2>
          <div className="space-y-4 text-slate-700">
            <div>
              <h3 className="font-semibold text-slate-900">A. Account & Profile Information</h3>
              <p className="mt-1">
                Name, work email address, company name, telephone number, billing address, tax identification numbers, and authentication credentials when creating an administrative or team member account.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-slate-900">B. Meta & WhatsApp Integration Data</h3>
              <p className="mt-1">
                When you link your Meta Business Portfolio through the Meta Embedded Signup workflow, we collect and store:
              </p>
              <ul className="list-disc pl-6 mt-2 space-y-1">
                <li>Meta Business Account ID and Portfolio Name</li>
                <li>WhatsApp Business Account (WABA) ID</li>
                <li>WhatsApp Phone Number ID and Verified Display Name</li>
                <li>Long-lived System User / Application Access Tokens</li>
                <li>Quality rating, messaging limits, and phone number verification status</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold text-slate-900">C. Customer Messaging & Interaction Content</h3>
              <p className="mt-1">
                To enable CRM inbox synchronization and automated campaign workflows, our platform processes:
              </p>
              <ul className="list-disc pl-6 mt-2 space-y-1">
                <li>End-user phone numbers (in E.164 international format)</li>
                <li>Inbound and outbound text messages, audio files, images, PDFs, and media attachments</li>
                <li>Message metadata: timestamps, message IDs, status indicators (sent, delivered, read, failed), and error failure codes</li>
                <li>Message template submissions, translation variables, and approval statuses</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold text-slate-900">D. Technical & Diagnostic Telemetry</h3>
              <p className="mt-1">
                IP addresses, browser type, operating system version, webhook latency, API error logs, and session activity to prevent fraud and maintain platform availability.
              </p>
            </div>
          </div>
        </section>

        {/* Section 3 */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            3. Purpose of Data Processing & Legal Basis
          </h2>
          <p className="text-slate-700 leading-relaxed">
            We process information under the following legal bases:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-100 text-slate-800 font-semibold">
                <tr>
                  <th className="p-3 border-b">Processing Purpose</th>
                  <th className="p-3 border-b">Legal Basis (GDPR / DPDP)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-600">
                <tr>
                  <td className="p-3 font-medium text-slate-800">Routing and delivering WhatsApp messages between Clients and End Users</td>
                  <td className="p-3">Contractual Necessity (Service Delivery)</td>
                </tr>
                <tr>
                  <td className="p-3 font-medium text-slate-800">Processing Embedded Signup and authenticating WABA access tokens</td>
                  <td className="p-3">Legitimate Business Interest & User Consent</td>
                </tr>
                <tr>
                  <td className="p-3 font-medium text-slate-800">Preventing spam, phishing, abusive behavior, and verifying policy compliance</td>
                  <td className="p-3">Legal Obligation & Protection of Platform Integrity</td>
                </tr>
                <tr>
                  <td className="p-3 font-medium text-slate-800">Billing, invoicing, and tax accounting compliance</td>
                  <td className="p-3">Legal Obligation</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 4 */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            4. Third-Party Subprocessors & Data Transfers
          </h2>
          <p className="text-slate-700 leading-relaxed">
            We do not sell, rent, monetize, or trade your personal or business data. We transfer data strictly to vetted subprocessors necessary for service execution:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li>
              <strong>Meta Platforms, Inc. (USA / Ireland):</strong> Provider of the WhatsApp Business Platform & Cloud API. Outbound and inbound messages, template syncs, and phone registrations are routed directly via Meta&apos;s infrastructure.
            </li>
            <li>
              <strong>Cloud Hosting & Database Providers:</strong> Enterprise cloud infrastructure providers (e.g., AWS / Google Cloud / Vercel) utilizing encrypted data centers.
            </li>
            <li>
              <strong>Payment Gateways:</strong> PCI-DSS certified payment processors (e.g., Stripe, Razorpay) handling subscription payments securely without Magnetora storing raw credit card details.
            </li>
          </ul>
        </section>

        {/* Section 5 */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            5. Security Standards & Encryption
          </h2>
          <p className="text-slate-700 leading-relaxed">
            Magnetora AI implements industry-standard administrative, physical, and technical safeguards:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-slate-700">
            <li><strong>Encryption in Transit:</strong> All web traffic and API calls are enforced over TLS 1.3 encryption.</li>
            <li><strong>Encryption at Rest:</strong> Database volumes, backups, and sensitive credentials (such as Meta API tokens) are encrypted using AES-256.</li>
            <li><strong>Access Control:</strong> Strict role-based access control (RBAC), multi-factor authentication (MFA) for engineers, and continuous audit logging.</li>
          </ul>
        </section>

        {/* Section 6 */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            6. Data Retention & Deletion Rights
          </h2>
          <p className="text-slate-700 leading-relaxed">
            We retain client messaging logs and contact profiles only for the duration of your active subscription, or as legally mandated for tax and security audits. 
          </p>
          <p className="text-slate-700 leading-relaxed">
            Clients and individuals retain the right to request the access, rectification, portability, or permanent erasure of their personal information at any time. For our formal deletion protocol and automated callback procedures, consult our{" "}
            <Link href="/data-deletion" className="text-indigo-600 font-semibold hover:underline">
              User Data Deletion Instructions
            </Link>
            .
          </p>
        </section>

        {/* Section 7 */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            7. Contact & Data Protection Officer (DPO)
          </h2>
          <p className="text-slate-700 leading-relaxed">
            If you have questions, grievances, or wish to exercise statutory privacy rights under GDPR, CCPA, or DPDP, please reach out to our privacy compliance office:
          </p>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-sm text-slate-700 space-y-2">
            <p><strong>Company:</strong> Magnetora AI Technologies</p>
            <p><strong>Attention:</strong> Data Protection Officer / Legal Department</p>
            <p><strong>Email:</strong> privacy@magnetora.ai</p>
            <p><strong>General Support:</strong> support@magnetora.ai</p>
          </div>
        </section>
      </div>
    </main>
  );
}
