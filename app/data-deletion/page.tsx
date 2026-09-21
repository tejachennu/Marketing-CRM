import React from "react";
import Link from "next/link";

export const metadata = {
  title: "Data Deletion Instructions | Magnetora AI",
  description: "Official instructions for deleting user and business data from Magnetora AI pursuant to Meta Platform policies.",
};

export default function DataDeletionPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-800 py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto bg-white p-8 sm:p-12 rounded-2xl shadow-sm border border-slate-200 space-y-10">
        
        {/* Header */}
        <header className="border-b border-slate-200 pb-8">
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">
            Meta Compliance & GDPR
          </span>
          <h1 className="mt-4 text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            User Data Deletion Instructions
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Instructions to remove your data, WhatsApp tokens, and account information.
          </p>
        </header>

        {/* Overview */}
        <section className="space-y-4 text-slate-700 leading-relaxed">
          <p>
            In accordance with <strong>Meta Platform Policy (Section 4.b)</strong>, the <strong>General Data Protection Regulation (GDPR)</strong>, and applicable international privacy frameworks, users of <strong>Magnetora AI</strong> have the right to request the permanent deletion of their account data, authentication tokens, contact lists, and message history.
          </p>
        </section>

        {/* Step 1 */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            Method 1: Revoke Meta Business Access Immediately
          </h2>
          <p className="text-slate-700">
            If you connected your WhatsApp Business Account (WABA) to Magnetora AI and wish to immediately cut off platform access without contacting support:
          </p>
          <div className="bg-slate-50 border border-slate-200 p-6 rounded-xl space-y-3 text-slate-700">
            <div className="flex items-start space-x-3">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white font-bold text-xs shrink-0 mt-0.5">1</span>
              <p>Log into your <a href="https://business.facebook.com" target="_blank" rel="noreferrer" className="text-indigo-600 font-semibold underline">Meta Business Manager</a>.</p>
            </div>
            <div className="flex items-start space-x-3">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white font-bold text-xs shrink-0 mt-0.5">2</span>
              <p>Navigate to <strong>Business Settings</strong> &gt; <strong>System Users</strong> or <strong>Accounts &gt; Apps</strong>.</p>
            </div>
            <div className="flex items-start space-x-3">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white font-bold text-xs shrink-0 mt-0.5">3</span>
              <p>Select <strong>Magnetora AI</strong> (App ID: <code>1747554262928162</code>).</p>
            </div>
            <div className="flex items-start space-x-3">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white font-bold text-xs shrink-0 mt-0.5">4</span>
              <p>Click <strong>Remove / Revoke Access</strong>.</p>
            </div>
          </div>
          <p className="text-xs text-slate-500 italic">
            * Once revoked, Magnetora AI can no longer make API calls or receive webhook events on behalf of your WhatsApp account.
          </p>
        </section>

        {/* Step 2 */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            Method 2: In-App Workspace Deletion
          </h2>
          <p className="text-slate-700">
            Workspace administrators can purge their channel connections directly inside the CRM:
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-slate-700">
            <li>Log into your <strong>Magnetora AI Dashboard</strong>.</li>
            <li>Go to <strong>Settings</strong> &gt; <strong>Channels</strong> &gt; <strong>WhatsApp</strong>.</li>
            <li>Click <strong>Disconnect WhatsApp Account</strong>.</li>
            <li>Check the confirmation box: <em>&quot;Purge stored tokens and message cache&quot;</em>.</li>
            <li>Click <strong>Confirm Disconnect</strong>.</li>
          </ol>
        </section>

        {/* Step 3 */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            Method 3: Direct Data Purge Request via Email
          </h2>
          <p className="text-slate-700">
            To request a complete hard purge of all workspace historical data, customer telephone directories, conversation transcripts, and media files from our primary databases and backup archives:
          </p>
          <div className="border border-slate-200 rounded-xl p-6 bg-white space-y-3">
            <p className="text-slate-700">
              Send an email to our Data Protection Team at:
            </p>
            <p className="text-lg font-bold text-indigo-600">
              privacy@magnetora.ai
            </p>
            <p className="text-sm text-slate-600">
              Please include:
            </p>
            <ul className="list-disc pl-6 text-sm text-slate-600 space-y-1">
              <li>Your Organization / Business Name</li>
              <li>Registered Admin Email Address</li>
              <li>Connected WhatsApp Business Account ID (WABA ID) or Phone Number</li>
              <li>Subject line: <strong>&quot;Data Erasure Request - GDPR / Meta Platform Policy&quot;</strong></li>
            </ul>
          </div>
        </section>

        {/* What gets deleted */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            Categories of Data Erased Upon Request
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
              <h3 className="font-semibold text-slate-900">WhatsApp Credentials</h3>
              <p className="mt-1 text-sm text-slate-600">System user tokens, WABA IDs, phone IDs, and webhook secrets permanently shredded.</p>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
              <h3 className="font-semibold text-slate-900">Customer Contacts</h3>
              <p className="mt-1 text-sm text-slate-600">End-user phone numbers, customer attributes, and custom tags deleted from CRM records.</p>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
              <h3 className="font-semibold text-slate-900">Message Logs & Transcripts</h3>
              <p className="mt-1 text-sm text-slate-600">All inbound and outbound message texts, chat history, and media attachments purged.</p>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
              <h3 className="font-semibold text-slate-900">Analytics & Metadata</h3>
              <p className="mt-1 text-sm text-slate-600">Delivery status reports, error telemetry, and template submission cache removed.</p>
            </div>
          </div>
        </section>

        {/* Timeline */}
        <section className="space-y-4 border-t border-slate-200 pt-8">
          <h2 className="text-2xl font-bold text-slate-900">
            Timeline for Completion
          </h2>
          <p className="text-slate-700 leading-relaxed">
            Requests submitted via email or in-app triggers are queued immediately. Primary production databases are purged within <strong>48 hours</strong>. Secure rolling backups and disaster recovery snapshots cycle out and permanently destroy residual data within a maximum of <strong>30 days</strong>. You will receive an official confirmation receipt with an audit confirmation code once the process is complete.
          </p>
          <p className="text-sm text-slate-500">
            For further information, review our{" "}
            <Link href="/privacy" className="text-indigo-600 hover:underline font-medium">
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link href="/terms" className="text-indigo-600 hover:underline font-medium">
              Terms and Conditions
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
