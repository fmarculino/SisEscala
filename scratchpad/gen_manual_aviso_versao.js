const fs=require('fs')
const p='src/app/(dashboard)/ajuda/conteudo/duvidas.ts'
let s=fs.readFileSync(p,'utf8')
const usaCrlf=s.includes('\r\n'); const nl=t=>usaCrlf?t.replace(/\n/g,'\r\n'):t
const velho=nl(`        { tipo: 'titulo', texto: 'A tela do terminal parece desatualizada' },`)
const c=s.split(velho).length-1
if(c!==1){console.error('ABORT:',c);process.exit(1)}
s=s.replace(velho,()=>nl(`        { tipo: 'titulo', texto: 'Fiz uma ação, o sistema disse que deu certo, e a tela não mudou' },
        {
          tipo: 'p',
          texto:
            'Antes de concluir que a ação falhou, **veja se apareceu uma tarja amarela no topo** dizendo que a página está desatualizada. O sistema é atualizado durante o dia, e uma aba que ficou aberta desde antes continua mostrando a tela antiga — a ação foi feita, quem não soube foi a página. Clique em **Atualizar agora** (ou recarregue) e confira de novo.',
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'A tarja não recarrega sozinha, e é de propósito',
          texto:
            'Numa grade de escala ou folha em edição, recarregar por conta própria apagaria o que você ainda não salvou. Por isso o sistema **avisa** e deixa o momento com você: salve o que está fazendo e então clique em Atualizar.',
        },

        { tipo: 'titulo', texto: 'A tela do terminal parece desatualizada' },`))
fs.writeFileSync(p,s)
console.log('manual ok')
