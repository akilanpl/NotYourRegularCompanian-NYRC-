export function verifyArchitecture(bytes,target){
 let actual='unknown';
 if(bytes.length>=32&&bytes.readUInt32LE(0)===0xfeedfacf){const cpu=bytes.readUInt32LE(4);actual=cpu===0x0100000c?'aarch64-apple-darwin':cpu===0x01000007?'x86_64-apple-darwin':'unknown';}
 else if(bytes.length>=20&&bytes.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46]))&&bytes[4]===2&&bytes[5]===1&&bytes.readUInt16LE(18)===62)actual='x86_64-unknown-linux-gnu';
 else if(bytes.length>=64&&bytes.readUInt16LE(0)===0x5a4d){const offset=bytes.readUInt32LE(0x3c);if(offset+6<=bytes.length&&bytes.readUInt32LE(offset)===0x00004550&&bytes.readUInt16LE(offset+4)===0x8664)actual='x86_64-pc-windows-msvc';}
 if(actual!==target)throw Error(`Binary architecture mismatch: requested ${target}, found ${actual}`);
 return actual;
}
