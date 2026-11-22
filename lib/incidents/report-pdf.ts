import type { Incident, IncidentAttachment } from "./model";
import { incidentReportSections } from "./report";

const safe=(value:string)=>value.replace(/[—–]/g,"-");
export async function createIncidentPdf(incident:Incident,projectName:string,evidence:IncidentAttachment[]=incident.attachments) {
 const {jsPDF}=await import("jspdf");const pdf=new jsPDF({unit:"mm",format:"a4",compress:true});
 const left=14,width=182,bottom=270;let y=14;
 function header(){
  pdf.setTextColor(24,24,27);pdf.setFont('times','normal');pdf.setFontSize(16);pdf.text('IDR M&M',left+2,17);
  pdf.setFontSize(7.5);
  for(const [index,[label,value]] of [['Organisation:','IDR M&M Construction'],['Address:','D. Mariano St., Concepcion Uno, Marikina City']].entries()){
   const x=left+35,baseline=13+index*5;pdf.setFont('helvetica','bold');pdf.text(label,x,baseline);const valueX=x+pdf.getTextWidth(label)+1.5;pdf.setFont('helvetica','normal');pdf.text(value,valueX,baseline);
  }
  pdf.setFont('helvetica','normal');const contact='+63 967 217 3481',x=left+width-pdf.getTextWidth(contact);pdf.text(contact,x,13);pdf.setFont('helvetica','bold');pdf.text('Contact Number:',x-pdf.getTextWidth('Contact Number:')-1.5,13);
  pdf.setDrawColor(24,24,27);pdf.setLineWidth(.35);pdf.line(left,22,left+width,22);
 }
 function footers(){
  const total=pdf.getNumberOfPages();
  const created=new Date(incident.created_at).toLocaleString('en-US',{timeZone:'Asia/Manila',weekday:'long',year:'numeric',month:'long',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true});
  for(let page=1;page<=total;page++){
   pdf.setPage(page);pdf.setDrawColor(24,24,27);pdf.setLineWidth(.3);pdf.line(left,276,left+width,276);pdf.setFontSize(7);
   const columns=[{label:'Prepared By:',value:incident.reporter_name||'Project member',x:left,align:'left'},{label:'Project:',value:projectName||'Not recorded',x:left+width/2,align:'center'},{label:'Form created:',value:created,x:left+width,align:'right'}] as const;
   for(const column of columns){
    pdf.setFont('helvetica','bold');pdf.setTextColor(24,24,27);
    if(column.align==='right'){pdf.text(column.label,column.x,280,{align:'right'});pdf.setFont('helvetica','normal');pdf.setTextColor(113,113,122);pdf.text(pdf.splitTextToSize(safe(column.value),width/3-4),column.x,284,{align:'right'});}
    else{const labelWidth=pdf.getTextWidth(column.label)+1;pdf.setFont('helvetica','normal');const lines=pdf.splitTextToSize(safe(column.value),width/3-4-labelWidth) as string[];const cellWidth=labelWidth+Math.max(...lines.map(line=>pdf.getTextWidth(line)));const x=column.align==='center'?column.x-cellWidth/2:column.x;pdf.setFont('helvetica','bold');pdf.text(column.label,x,280);pdf.setFont('helvetica','normal');pdf.setTextColor(113,113,122);pdf.text(lines,x+labelWidth,280);}
   }
   pdf.setFontSize(7);pdf.text(`Page ${page} of ${total}`,105,294,{align:'center'});
  }
 }
 function page(){pdf.addPage();header();y=29;}
 function room(height:number){if(y+height>bottom)page();}
 function section(title:string){room(16);pdf.setFillColor(235,235,235);pdf.rect(left,y,width,8,'F');pdf.setFont('helvetica','bold');pdf.setFontSize(9);pdf.setTextColor(35);pdf.text(title.toUpperCase(),left+3,y+5.3);y+=10;}
 function row(values:string[],widths:number[],heading=false){
  pdf.setFont('helvetica',heading?'bold':'normal');pdf.setFontSize(8);
  const lines=values.map((value,i)=>{pdf.setFont('helvetica',heading||values.length===2&&i===0?'bold':'normal');return pdf.splitTextToSize(safe(value),widths[i]-6) as string[];});const count=Math.max(1,...lines.map(value=>value.length));
  let offset=0;
  while(offset<count){room(9);const batch=Math.min(count-offset,Math.max(1,Math.floor((bottom-y-4)/4)));const height=Math.max(8,batch*4+4);let x=left;
   pdf.setFont('helvetica',heading?'bold':'normal');pdf.setFontSize(8);
   pdf.setDrawColor(220);pdf.setLineWidth(.2);pdf.line(left,y+height,left+width,y+height);
   values.forEach((_,i)=>{pdf.setFont('helvetica',heading||values.length===2&&i===0?'bold':'normal');pdf.setTextColor(heading||values.length===2&&i===0?80:30);const chunk=lines[i].slice(offset,offset+batch);if(chunk.length)pdf.text(chunk,x+2,y+4.7);x+=widths[i];});
   y+=height;offset+=batch;if(offset<count)page();
  }
 }
 header();y=31;pdf.setFont('helvetica','bold');pdf.setFontSize(14);pdf.setTextColor(24,24,27);pdf.text('INCIDENT REPORT',left,y);y+=9;
 for(const group of incidentReportSections(incident)){section(group.title);const widths=group.columns.length===3?[60,50,72]:[48,134];if(group.columns.length===3)row(group.columns,widths,true);for(const values of group.rows)row(values,widths);y+=6;}
 const attachments=[...evidence,...(incident.closeout?.attachments??[])];
 section('Attachments');
 if(!attachments.length)row(['Attachments','No attachments.'],[48,134]);
 for(const file of attachments){
  row(['Attachment',file.name],[48,134]);
  if(!file.type.startsWith('image/')||!file.url)continue;
  try{
   const response=await fetch(file.url);if(!response.ok)throw new Error('Unavailable');
   const bitmap=await createImageBitmap(await response.blob());const canvas=document.createElement('canvas');const scale=Math.min(1,1400/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const context=canvas.getContext('2d');if(!context){bitmap.close();throw new Error('Unavailable');}context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
   const imageWidth=Math.min(width,90*canvas.width/canvas.height),height=imageWidth*canvas.height/canvas.width;room(height+4);pdf.addImage(canvas.toDataURL('image/jpeg',.85),'JPEG',left,y,imageWidth,height);y+=height+4;
  }catch{row(['Preview','Image preview unavailable; attachment remains recorded in the system.'],[48,134]);}
 }
 footers();return pdf;
}
export async function downloadIncidentPdf(incident:Incident,projectName:string,evidence:IncidentAttachment[]) {
 const pdf=await createIncidentPdf(incident,projectName,evidence);
 const name=`${projectName||'IDRMM'} - ${incident.occurred_on} Incident Report`.replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').slice(0,150);
 pdf.save(`${name}.pdf`);
}
