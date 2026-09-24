export function accountFields(body: Record<string, unknown>) {
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const organization =
    typeof body.organization === "string" ? body.organization.trim() : "";
  const invitation = typeof body.invitation === "string" ? body.invitation : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new Error("Enter a valid work email.");
  if (invitation && !/^[a-f0-9]{64}$/.test(invitation))
    throw new Error("This invitation link is invalid.");
  if (name.length > 100 || organization.length > 150)
    throw new Error("Name or business name is too long.");
  return { email, password, name, organization, invitation };
}

export function signupFields(body: Record<string, unknown>) {
  const fields = accountFields(body);
  if (!fields.name || (!fields.invitation && !fields.organization))
    throw new Error("Enter your name and business name.");
  requirePasswordLength(fields.password);
  return fields;
}

export function requirePasswordLength(password: string) {
  if (password.length < 12 || password.length > 128)
    throw new Error("Use a password between 12 and 128 characters.");
}
