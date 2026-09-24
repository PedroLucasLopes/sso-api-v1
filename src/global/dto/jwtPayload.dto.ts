export class JwtPayload {
  sub: string;
  projectId: string;
  role: string;
  routes: { path: string; method: string }[];
}
