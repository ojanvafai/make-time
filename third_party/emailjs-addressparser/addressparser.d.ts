export interface Address {
  name: string;
  address: string;
}

export interface AddressWithGroup extends Address {
  group?: Address[];
}

declare function parse(str: string): AddressWithGroup[];
export default parse;
