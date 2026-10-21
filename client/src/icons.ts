import type { CardBrand } from '@ccm/shared';

// 卡组织是固定目录，名称和本地图标集中维护；与每张卡的卡面图片独立。
export const CARD_NETWORKS = {
  visa:{label:'Visa',icon:'/brands/visa.svg'},
  mastercard:{label:'Mastercard',icon:'/brands/mastercard.svg'},
  jcb:{label:'JCB',icon:'/brands/jcb.svg'},
  amex:{label:'American Express',icon:'/brands/amex.svg'},
  diners:{label:'Diners Club',icon:'/brands/diners.svg'},
  discover:{label:'Discover',icon:'/brands/discover.svg'},
  unionpay:{label:'银联 UnionPay',icon:'/brands/unionpay.svg'},
  maestro:{label:'Maestro',icon:'/brands/maestro.svg'},
} as const satisfies Record<CardBrand,{label:string;icon:string}>;
