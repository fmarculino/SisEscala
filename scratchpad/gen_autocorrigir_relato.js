const fs=require('fs')
const p='src/app/(dashboard)/folha-ponto/actions.ts'
let s=fs.readFileSync(p,'utf8')
const crlf=t=>t.replace(/\n/g,'\r\n')
const v=crlf(`    revalidatePath('/folha-ponto')

    return {
      success: true,
      totalFolhasCorrigidas,
      totalDiasCorrigidos,
      resumo: resumoPorServidor
    }
  } catch (error: any) {
    console.error('Erro em autoCorrigirTodasFolhasPonto:', error)`)
const c=s.split(v).length-1
if(c!==1){console.error('ABORT: '+c+' ocorrencias');process.exit(1)}
s=s.replace(v,()=>crlf(`    revalidatePath('/folha-ponto')

    return {
      success: true,
      completo,
      totalFolhasAnalisadas: folhas.length,
      totalFolhasCorrigidas,
      totalDiasCorrigidos,
      resumo: resumoPorServidor
    }
  } catch (error: any) {
    console.error('Erro em autoCorrigirTodasFolhasPonto:', error)`))
fs.writeFileSync(p,s)
console.log('ok')
