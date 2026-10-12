export const BOSS_TOOL_EXTENSION={
  usage:'\n  office-workers boss state [--json]    inspect mission, backlog and steering\n  office-workers boss action < action.json   submit proposals, focus, or steering acknowledgment',
  actions:{'boss.state':'/boss','boss.action':'/boss'},reads:['boss.state'],
  tools:[
    {name:'boss_state',title:'Read Boss mission and state',description:'Read your floor’s Boss-mode mission, backlog, steering and progress.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
    {name:'boss_action',title:'Report Boss decisions',description:'The active boss can propose initiatives with evidence and acceptance criteria, report focus on its workers, or acknowledge applied steering. Read state for the current revision first.',inputSchema:{type:'object',properties:{action:{type:'string',enum:['propose','focus','ack-steering']},revision:{type:'integer'},items:{type:'array',items:{type:'object'}},summary:{type:'string'},workerId:{type:'string'},activity:{type:'string'},ids:{type:'array',items:{type:'string'}}},required:['action']},annotations:{destructiveHint:false}},
  ],
  parse(argv){if(argv[0]!=='boss')return;const action=argv[1]??'state';if(!['state','action'].includes(action)||argv.slice(2).some(v=>v!=='--json'))throw Error('Use boss state or boss action with JSON stdin');return {cmd:'boss.'+action};},
  async run(cmd,{call,readStdin,stdin,out,ctx}){const body=cmd.cmd==='boss.action'?JSON.parse(await readStdin(stdin)):undefined;out(JSON.stringify(await call(cmd.cmd,body,ctx),null,2));return 0;},
  async runTool(name,args,{call,io}){return {text:JSON.stringify(await call(name==='boss_state'?'boss.state':'boss.action',args,io),null,2)};},
};
