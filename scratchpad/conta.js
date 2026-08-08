const fs=require('fs'),path=require('path')
const MIG='c:/Users/Cliente/Projetos/SisEscala/supabase/migrations'
const read=f=>fs.readFileSync(path.join(MIG,f),'utf8')
const c=(s,n)=>s.split(n).length-1
function fatiar(src,ini){const i=src.indexOf(ini);const t='$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;';const j=src.indexOf(t,i);return src.slice(i,j+t.length)}
const term=fatiar(read('20260807050000_support_flexible_interval_per_servidor.sql'),'CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca(')
const man=fatiar(read('20260807100000_restore_interval_marks_on_period_scopes.sql'),'CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca_manual(')
const sb=read('20260808040000_add_fn_blocos_previstos_dia.sql');const ib=sb.indexOf('CREATE OR REPLACE FUNCTION public.fn_blocos_previstos_dia(');const blk=sb.slice(ib,sb.indexOf('$fnbloco$;',ib)+10)
const needles=["<> 'Sobreaviso'","fn_jornada_tem_intervalo","CASE WHEN ed.categoria = 'Plantão' THEN","ed.categoria IN ('Regular', 'Plantão', 'Extra')","ORDER BY start_hour ASC","fn_ajuste_intervalo_flexivel","p_categoria::public.escala_categoria","justificativa_manual","presenca_entrada_manual","p_categoria <> 'Sobreaviso'","CASE WHEN ed.categoria = 'Regular' THEN"]
for(const [nome,corpo] of [['terminal',term],['manual',man],['blocos',blk]]){
  console.log('=== '+nome+'  ('+corpo.length+' bytes, '+corpo.split('\n').length+' linhas)')
  for(const n of needles) console.log('   '+String(c(corpo,n)).padStart(3)+'  '+n)
}
// regex de insercao
const R=/CASE WHEN ed\.categoria = 'Plantão' THEN\r?\n(\s*)COALESCE\(\r?\n/g
for(const [nome,corpo] of [['terminal',term],['manual',man],['blocos',blk]]){
  const m=[...corpo.matchAll(R)];console.log('regex casa em '+nome+': '+m.length+' | indent='+m.map(x=>JSON.stringify(x[1])).join(','))
}
