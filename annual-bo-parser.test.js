const fs=require('fs');
const path=require('path');
const vm=require('vm');

const indexPath=process.argv[2]||path.join(__dirname,'index.html');
const html=fs.readFileSync(indexPath,'utf8');
const start=html.indexOf('function parseAnnualDate(');
const end=html.indexOf('function projectionPreview(',start);
if(start<0||end<0) throw new Error('No se encontró el parser BO anual en index.html');

const context={
  console,Date,Math,JSON,Object,Array,Set,Map,String,Number,
  ANNUAL_CATEGORIES:['ROSAS','COMPUESTOS','SIMPLES','PLANTAS'],
  cloneData:value=>JSON.parse(JSON.stringify(value??null)),
  escapeHtml:value=>String(value??''),
  annualNumber:value=>String(value??''),
  annualKey:(year,week)=>`${year}-${String(week).padStart(2,'0')}`,
  dateIso:date=>date.toISOString().slice(0,10),
  isoYearForDate(input){const date=new Date(Date.UTC(input.getUTCFullYear(),input.getUTCMonth(),input.getUTCDate()));date.setUTCDate(date.getUTCDate()+4-(date.getUTCDay()||7));return date.getUTCFullYear();},
  getISOWeek(input){const date=new Date(Date.UTC(input.getUTCFullYear(),input.getUTCMonth(),input.getUTCDate()));date.setUTCDate(date.getUTCDate()+4-(date.getUTCDay()||7));const yearStart=new Date(Date.UTC(date.getUTCFullYear(),0,1));return Math.ceil((((date-yearStart)/86400000)+1)/7);},
  getISOWeekRange(){return {start:new Date('2026-07-13T00:00:00Z'),end:new Date('2026-07-19T00:00:00Z')}}
};
vm.createContext(context);
vm.runInContext(html.slice(start,end),context);

const COMPLETE_BLOCK=`Produits de production - Expï¿½dition par date d'expï¿½dition du 13072026 au 19072026

code	type	reference	Total	Lundi 2026/07/13	Mardi 2026/07/14	Mercredi 2026/07/15	Jeudi 2026/07/16	Vendredi 2026/07/17	Samedi 2026/07/18
9031	Plante	P-Bonsai	2	1			1		
56058	Bouquet	C-Lys-champetre	21	6	7	4	1	3	
53933	Bouquet	C-ZODIAC-CANCER	12	2	3	3	2	2	
50971	Bouquet	C-BLEU-PARFUME	26	13	8	2	2	1	
50434	Service	X-Foto	42	7	9	8	9	9	
49169	Bouquet	C-PASTEL_HIVERS	9	5	1	2	1		
45528	Bouquet	C-GIRASOLES-BQT	23	6	8	2	4	3	
39319	Bouquet	C-deep-purple	9	1	2	3	3		
38332	Bouquet	C-LUX_HORTENSIA_SWEET	14	3	3	2	4	2	
38088	Bouquet	C-TOURNESOL	28	4	7	7	6	4	
37614	Bouquet	C-STATICE-ROMANTICO	12	3	3	1	3	2	
37006	Bouquet	C-AUTHENTIQUE	18	2	2	6	6	2	
35805	Cadeau	S_ pot_blanco_13cm	11	2	1	2	5	1	
35641	Bouquet	C-TOSCANA-PASTEL	32	7	3	11	4	7	
33551	Plante	P-Orqui-BLANCA	5	2			2	1	
32486	Bouquet	S-Premium-12-18-24-30-roja	48	8	11	12	10	7	
31056	Rose	A-ROSAS-ETHIOPIA	48	9	8	16	9	6	
30640	Bouquet	C-RAMO-FLORISTA	58	17	11	10	15	5	
29205	Bouquet	TF-Naranja - AQ001	7	2	3		1		1
28206	Plante	P-Orqui-ROSA	6		1	2	3		
25148	Bouquet	S-Alstro_parme_	6		1	2	3		
22652	Bouquet	TF-Rosa-AQ004	4	1				2	1
21599	Bouquet	TF-Blanco-AQ002	1					1	
21513	Compositions	TF-ramofunerario_TR3201	1					1	
21455	Bouquet	TF-Gerberas-AQ008	1				1		
21117	Bouquet	TF-Amarillo-AQ003	1					1	
18919	Bouquet	S-R-Blanc-Prem-12-18-24-30	15	4	1	6	3	1	
18746	Deuil	TF-corona_TR3102	1					1	
18397	Bouquet	S-Lilium-Rosa-6-8-10	18	3	3	6	5	1	
17127	Rose	A-Rosas-Colores-30-40-50-60	120	29	19	28	30	14	
TOTAL			599	137	115	135	133	77	2
Fichier Export CSV	Camenbert	Courbe	Bar`;

function parse(text){
  context.input=text;
  return vm.runInContext("parseAnnualBoRows(parseAnnualBoPastedText(input),2026,'ejemplo completo')",context);
}
function mapTotals(rows){
  return Object.fromEntries(rows.map(item=>[item.product_reference,item.dailyTotal]));
}
function assertEqual(actual,expected,label){
  if(actual!==expected) throw new Error(`${label}: esperado ${expected}, obtenido ${actual}`);
}

const result=parse(COMPLETE_BLOCK);
const expectedCategories={ROSAS:168,COMPUESTOS:262,SIMPLES:87,PLANTAS:13};
for(const [category,total] of Object.entries(expectedCategories)) assertEqual(result.categories[category],total,category);
assertEqual(result.total,530,'TOTAL');
assertEqual(result.included.length,21,'referencias incluidas');
assertEqual(result.records.length,94,'registros diarios');
assertEqual(result.warnings.length,0,'filas descuadradas');
assertEqual(result.unrecognized.length,0,'referencias no reconocidas');
assertEqual(result.total+result.excluded.reduce((sum,item)=>sum+item.dailyTotal,0),599,'total general antes de exclusiones');

const expectedIncluded={
  'A-Rosas-Colores-30-40-50-60':120,'A-ROSAS-ETHIOPIA':48,
  'C-AUTHENTIQUE':18,'C-BLEU-PARFUME':26,'C-deep-purple':9,'C-GIRASOLES-BQT':23,
  'C-LUX_HORTENSIA_SWEET':14,'C-Lys-champetre':21,'C-PASTEL_HIVERS':9,
  'C-RAMO-FLORISTA':58,'C-STATICE-ROMANTICO':12,'C-TOSCANA-PASTEL':32,
  'C-TOURNESOL':28,'C-ZODIAC-CANCER':12,
  'S-Alstro_parme_':6,'S-Lilium-Rosa-6-8-10':18,'S-Premium-12-18-24-30-roja':48,
  'S-R-Blanc-Prem-12-18-24-30':15,
  'P-Bonsai':2,'P-Orqui-BLANCA':5,'P-Orqui-ROSA':6
};
const actualIncluded=mapTotals(result.included);
assertEqual(Object.keys(actualIncluded).length,Object.keys(expectedIncluded).length,'detalle de referencias incluidas');
for(const [reference,total] of Object.entries(expectedIncluded)) assertEqual(actualIncluded[reference],total,reference);

const expectedExcluded={
  'X-Foto':42,'S_ pot_blanco_13cm':11,'TF-Naranja - AQ001':7,'TF-Rosa-AQ004':4,
  'TF-Blanco-AQ002':1,'TF-ramofunerario_TR3201':1,'TF-Gerberas-AQ008':1,
  'TF-Amarillo-AQ003':1,'TF-corona_TR3102':1
};
const actualExcluded=mapTotals(result.excluded);
for(const [reference,total] of Object.entries(expectedExcluded)) assertEqual(actualExcluded[reference],total,`excluida ${reference}`);
if(result.excluded.some(item=>!item.reason)) throw new Error('Hay una exclusión sin motivo');
if([...result.included,...result.excluded].some(item=>item.declaredTotal!==item.dailyTotal)) throw new Error('Una fila no cuadra con su columna Total');

const spaced=parse(COMPLETE_BLOCK.replace('56058\tBouquet\tC-Lys-champetre\t21\t6\t7\t4\t1\t3\t','  56058  \t  Bouquet  \t  C-Lys-champetre  \t 21 \t 6 \t 7 \t 4 \t 1 \t 3 \t'));
assertEqual(spaced.total,530,'variante con espacios y sábado vacío');

const mismatch=parse(COMPLETE_BLOCK.replace('9031\tPlante\tP-Bonsai\t2\t','9031\tPlante\tP-Bonsai\t3\t'));
assertEqual(mismatch.warnings.length,1,'advertencias por descuadre');
assertEqual(mismatch.warnings[0].dailyTotal,2,'suma diaria advertida');
assertEqual(mismatch.warnings[0].declaredTotal,3,'Total declarado advertido');

console.log(JSON.stringify({
  included:result.included,
  excluded:result.excluded,
  unrecognized:result.unrecognized,
  warnings:result.warnings,
  categories:result.categories,
  total:result.total,
  dailyRecords:result.records.length,
  sampleRecords:result.records.slice(0,20)
},null,2));
