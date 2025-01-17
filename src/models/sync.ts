import mongoose from "mongoose"
const schema = new mongoose.Schema({
    medusaid:String,
    medusaNmae:String,
    directusId:String,
    directusNmae:String,
    images:[],
    description:String

},{timestamps:true});
export const sync = mongoose.model("sync",schema)