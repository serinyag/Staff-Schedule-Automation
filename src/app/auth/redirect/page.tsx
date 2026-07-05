import { redirect } from "next/navigation";
import { getAuthenticatedAppContext, getDefaultSignedInPath } from "@/lib/authenticated-app";

export default async function AuthRedirectPage() {
  const context = await getAuthenticatedAppContext();

  redirect(getDefaultSignedInPath(context.profile.app_role));
}
