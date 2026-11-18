import { confinedPath } from "@/core/mailboxes/paths";
import { validateDomain } from "@/core/mailboxes/validators";
import { readFile } from "node:fs/promises";
import "server-only";

export interface OpenDkimRecordResult {
  readonly available: boolean;
  readonly copyable: boolean;
  readonly value: string;
}

const MISSING_DKIM_MESSAGE =
  "DKIM public key is not provisioned for this domain.";

export function parseOpenDkimPublicKeyFile(
  content: string,
): OpenDkimRecordResult {
  const fragments: string[] = [];
  const pattern = /"([^"]*)"/g;
  let match: RegExpExecArray | null = pattern.exec(content);
  while (match !== null) {
    fragments.push(match[1]);
    match = pattern.exec(content);
  }

  const joined = fragments.join("");
  const keySplit = joined.split("p=", 2);
  if (keySplit.length !== 2) {
    return {
      available: false,
      copyable: false,
      value: MISSING_DKIM_MESSAGE,
    };
  }

  const publicKey = keySplit[1].split(";", 1)[0]?.trim() ?? "";
  if (!publicKey || !/^[A-Za-z0-9+/=]+$/.test(publicKey)) {
    return {
      available: false,
      copyable: false,
      value: MISSING_DKIM_MESSAGE,
    };
  }

  return {
    available: true,
    copyable: true,
    value: `v=DKIM1; k=rsa; p=${publicKey}`,
  };
}

export async function readOpenDkimRecord(
  domain: string,
  keysRoot: string,
): Promise<OpenDkimRecordResult> {
  try {
    const normalizedDomain = validateDomain(domain);
    const keyFilePath = confinedPath(keysRoot, normalizedDomain, "mail.txt");
    const content = await readFile(keyFilePath, "ascii");
    return parseOpenDkimPublicKeyFile(content);
  } catch {
    return {
      available: false,
      copyable: false,
      value: MISSING_DKIM_MESSAGE,
    };
  }
}
