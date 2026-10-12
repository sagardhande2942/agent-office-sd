export function signInFailure(status:number):string {
  if(status===401||status===403)return 'Sign-in rejected. Use the server password, or --name NAME with that account’s password.';
  if(status===429)return 'Too many sign-in attempts. Wait before trying again.';
  return `Sign-in failed (${status}). Check that --office points to an Agent Office server.`;
}
export function connectionFailure(error:unknown,origin:string):string {
  const e=error as Error & {code?:string;cause?:{code?:string}};
  const code=e.cause?.code??e.code;
  if(code==='ECONNREFUSED')return `No office is listening at ${origin}. Start agent-office /path/to/project --no-open in another terminal, or set --office to your running server.`;
  if(code==='ENOTFOUND')return `Cannot find the office host at ${origin}. Check the --office address.`;
  if(e.name==='TimeoutError')return `The office at ${origin} did not respond within 15 seconds. Check the server address and connection.`;
  return e.message??String(error);
}
