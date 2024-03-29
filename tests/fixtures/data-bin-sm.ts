/**
 * intData:        ... < 128
 * surrogateData:  0 or D8-DF
 * mixedData:      0...255 including D8-DF
 * randomData:     any
 * (length of each data: 106 bytes)
 */
export const
surrogateData: number[] = // 0 or D8-DF
[ '',
  'D800',        '00D9',
  'DADB',        '00DCDE00',
  'D8D9DA00',    '00DBDCDE',
  'D8D9DADB',    '00DCDEDFD800',
  'D8D9DADBDC00','00DEDFD8D9DA',
  'D8D9DADBDCDE','00DFD8D9DADBDC00',
  ''
].join('0000'+'0000')
 .match(/../g)?.map(x=>parseInt(x,16))||[],
intData: number[] = Array.from(surrogateData, (v,i)=>i),
mixedData: number[] = Array.from(surrogateData, (v,i)=>v||i*17&255),
randomData: number[] = Array.from(surrogateData, (v,i)=>v||Math.random()*256|0);
