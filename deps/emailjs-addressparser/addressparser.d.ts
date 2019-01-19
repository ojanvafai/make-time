interface Address {
  name: string, address: string
}
declare function parse(str: string): Address[];
export default parse;
