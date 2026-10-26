import { authorizeCandidateAccess } from "./candidate-access.ts";

export const authorizeTranscription = (token: string) =>
  authorizeCandidateAccess(token, ["candidate_ready", "active"]);
