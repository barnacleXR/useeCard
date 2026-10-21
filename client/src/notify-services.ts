// Apprise URL 只用于提交给服务端；不在预览、列表或持久化浏览器状态中显示。
export type NotifyServiceId='telegram'|'email'|'discord'|'bark'|'ntfy'|'custom';
export interface NotifyField {key:string;label:string;secret?:boolean;placeholder?:string;options?:{value:string;label:string}[]}
export const notifyServices:{id:NotifyServiceId;name:string;steps:string[];fields:NotifyField[]}[]=[
 {id:'telegram',name:'Telegram',steps:['通过 @BotFather 的 /newbot 创建机器人，取得 Bot Token。','打开机器人并发送 /start；填写接收消息的 Chat ID（群组 ID 可以是负数）。'],fields:[{key:'token',label:'Bot Token',secret:true,placeholder:'123456789:AA…'},{key:'chat',label:'Chat ID',placeholder:'123456789 或 -100…'}]},
 {id:'email',name:'Email / SMTP',steps:['填写邮件服务提供的 SMTP 配置。Gmail 等服务请使用应用专用密码。','STARTTLS 通常使用 587 端口，SSL 通常使用 465；收件人可与发件人不同。'],fields:[{key:'host',label:'SMTP 服务器',placeholder:'smtp.gmail.com'},{key:'port',label:'端口',placeholder:'587'},{key:'tls',label:'加密方式',options:[{value:'starttls',label:'STARTTLS'},{value:'ssl',label:'SSL / TLS'}]},{key:'user',label:'SMTP 用户名',placeholder:'you@example.com'},{key:'password',label:'SMTP 密码 / 应用专用密码',secret:true},{key:'sender',label:'发件邮箱',placeholder:'you@example.com'},{key:'recipient',label:'收件邮箱',placeholder:'you@example.com'}]},
 {id:'discord',name:'Discord',steps:['在 Discord 服务器设置 → 整合 → Webhook 中创建 Webhook，并选择接收频道。','复制 Webhook 网址，粘贴到下方。'],fields:[{key:'webhook',label:'Webhook 网址',secret:true,placeholder:'https://discord.com/api/webhooks/…'}]},
 {id:'bark',name:'Bark',steps:['在 iPhone 安装 Bark 并允许通知。','复制 Bark 首页的推送 Key，粘贴到下方。'],fields:[{key:'key',label:'Bark 推送 Key',secret:true}]},
 {id:'ntfy',name:'ntfy',steps:['在 ntfy App 中订阅一个难以猜到的主题名。','填写同一个主题名。知道公开主题名的人可能收到消息，请妥善保存。'],fields:[{key:'topic',label:'ntfy.sh 主题名',secret:true}]},
 {id:'custom',name:'其他 Apprise 服务',steps:['填写完整 Apprise 地址，每次添加一个目标。','可使用 Apprise 支持的其他服务；服务端通过你的 Apprise 网关投递。'],fields:[{key:'url',label:'Apprise 地址',secret:true,placeholder:'scheme://…'}]},
];
export function buildNotifyUrl(service:NotifyServiceId,values:Record<string,string>):string {
 const value=(key:string)=>values[key]?.trim()||'';
 if(service==='telegram'){
  if(!/^\d+:[A-Za-z0-9_-]+$/.test(value('token'))||!/^(-?\d+|@[A-Za-z0-9_]+)$/.test(value('chat')))throw new Error('请检查 Bot Token 和 Chat ID 格式');
  return `tgram://${value('token')}/${value('chat')}`;
 }
 if(service==='email'){
  if(!/^[a-z0-9.-]+$/i.test(value('host'))||!/^\d{1,5}$/.test(value('port'))||Number(value('port'))<1||Number(value('port'))>65535)throw new Error('请检查 SMTP 服务器和端口');
  if(!value('user')||!value('password')||!/^\S+@[^@\s]+\.[^@\s]+$/.test(value('sender'))||!/^\S+@[^@\s]+\.[^@\s]+$/.test(value('recipient')))throw new Error('请填写 SMTP 登录信息和合法的发件、收件邮箱');
  if(!['starttls','ssl'].includes(value('tls')))throw new Error('请选择邮件加密方式');
  const params=new URLSearchParams({user:value('user'),pass:values.password||'',smtp:value('host'),from:value('sender'),to:value('recipient'),mode:value('tls')});
  return `mailtos://${value('sender').split('@')[1]}:${value('port')}?${params}`;
 }
 if(service==='discord'){
  const match=value('webhook').match(/^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/(\d+)\/([A-Za-z0-9_-]+)\/?(?:\?.*)?$/);
  if(!match)throw new Error('请输入 Discord Webhook 网址');return `discord://${match[1]}/${match[2]}/`;
 }
 if(service==='bark'){if(!/^[A-Za-z0-9_-]+$/.test(value('key')))throw new Error('请填写 Bark 推送 Key');return `bark://api.day.app/${value('key')}`;}
 if(service==='ntfy'){if(!/^[A-Za-z0-9_-]{6,64}$/.test(value('topic')))throw new Error('主题名须为 6–64 位字母、数字、下划线或短横线');return `ntfys://${value('topic')}`;}
 if(!/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(value('url'))||/[\r\n,]/.test(value('url')))throw new Error('请输入单个完整 Apprise 地址');
 return value('url');
}
