import * as fs from "fs";

interface RawData {
  NativeClass: string;
  Classes: RawClass[];
}
interface RawClass {
  ClassName: string;
  mDisplayName?: string;
  mDescription?: string;
  [key: string]: unknown;
}

let fileContent = fs.readFileSync("./Docs-en-US-UTF-8.json").toString();
if (fileContent.charCodeAt(0) === 0xfeff) {
  fileContent = fileContent.slice(1);
}
const rawData: RawData[] = JSON.parse(fileContent.toString());

console.log(rawData.length);

for (const group of rawData) {
  // if (group.NativeClass.includes("FGItemDesc")) {
  // console.log(group.NativeClass);
  // }
  // if (group.NativeClass.includes("Ammo")) {
  // console.log(group.NativeClass);
  // }
  console.log(group.NativeClass);
  console.log(group.Classes.length);
}
