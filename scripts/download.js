import degit from 'degit';

async function main() {
  await degit('tandpfun/skill-icons/icons', { force: true }).clone('./assets');
}

main();
