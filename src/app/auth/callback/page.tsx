import { EmailLinkCallback } from "@/features/lunarsprints/ui/email-link-callback";

export const metadata = { title: "Signing you in | LunarSprints" };

export default function AuthCallbackPage() {
  return <EmailLinkCallback />;
}
