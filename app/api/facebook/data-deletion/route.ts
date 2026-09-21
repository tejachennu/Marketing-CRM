import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function GET() {
  return NextResponse.json({
    status: "active",
    service: "WAMACRM (Magnetora AI) Data Deletion Callback Endpoint",
    documentation: "https://marketing-crm-pi.vercel.app/data-deletion",
  });
}

export async function POST(req: NextRequest) {
  try {
    let signedRequest = "";
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      signedRequest = (formData.get("signed_request") as string) || "";
    } else if (contentType.includes("application/json")) {
      const body = await req.json();
      signedRequest = body.signed_request || "";
    }

    let userId = "user";
    if (signedRequest && signedRequest.includes(".")) {
      try {
        const [, payloadEncoded] = signedRequest.split(".");
        const payloadJson = Buffer.from(payloadEncoded, "base64url").toString("utf-8");
        const parsed = JSON.parse(payloadJson);
        if (parsed.user_id) {
          userId = parsed.user_id;
        }
      } catch {
        // Fallback if parsing fails
      }
    }

    // Generate unique confirmation code for tracking
    const confirmationCode = `DEL_${Date.now()}_${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const statusUrl = `https://marketing-crm-pi.vercel.app/data-deletion?code=${confirmationCode}&userId=${userId}`;

    // Meta strictly expects: { url: "<status_url>", confirmation_code: "<code>" }
    return NextResponse.json({
      url: statusUrl,
      confirmation_code: confirmationCode,
    });
  } catch (error) {
    console.error("[Data Deletion Callback Error]:", error);
    const fallbackCode = `DEL_${Date.now()}`;
    return NextResponse.json({
      url: `https://marketing-crm-pi.vercel.app/data-deletion?code=${fallbackCode}`,
      confirmation_code: fallbackCode,
    });
  }
}
