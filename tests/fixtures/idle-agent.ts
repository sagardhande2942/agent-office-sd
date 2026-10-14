/** Interactive workers stay alive; incidental one-shot label/version requests finish. */
export const idleAgent = `#!${process.execPath}
if (process.argv.includes('--version')) {
  console.log('1.0.0'); process.exit(0);
}
if (process.argv.includes('-p')) {
  console.log(JSON.stringify({ structured_output: { name: 'Fixture task', summary: 'Fixture work' } }));
  process.exit(0);
}
setInterval(() => {}, 1000);
`;
