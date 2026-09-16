const fs=require('fs')
const p='src/app/(dashboard)/layout.tsx'
let s=fs.readFileSync(p,'utf8')
const usaCrlf=s.includes('\r\n'); const nl=t=>usaCrlf?t.replace(/\n/g,'\r\n'):t
function sub(rot,velho,novo){
  const v=nl(velho),n=nl(novo); const c=s.split(v).length-1
  if(c!==1){console.error(`ABORT ${rot}: ${c}`);process.exit(1)}
  s=s.replace(v,()=>n)
}
sub('import',
"import { Sidebar } from '@/components/layout/sidebar'",
"import { Sidebar } from '@/components/layout/sidebar'\nimport { AvisoVersaoDesatualizada } from '@/components/AvisoVersaoDesatualizada'")
sub('render',
`      <Sidebar user={profile} />
      <main className="flex-1 overflow-y-auto p-8">
        {children}
      </main>`,
`      <Sidebar user={profile} />
      <main className="flex-1 overflow-y-auto">
        {/* Fica DENTRO do main, que e o elemento que rola: uma tarja \`sticky\` num pai sem
            scroll nao gruda em lugar nenhum e sai da tela na primeira rolagem. */}
        <AvisoVersaoDesatualizada />
        <div className="p-8">
          {children}
        </div>
      </main>`)
fs.writeFileSync(p,s)
console.log('layout ok')
