var ometa = require('../../../deps/ometa'),
    CParser = require('../../c/grammars/c_parser.ojs'),
    CTranslator = require('../../c/grammars/c_translator.ojs'),
    readline = require('readline'),
    fs = require('fs');

fs.readFile("in.c", "utf8", function(err, data) {
  if (err) {
    return console.log(err);
  }
  try {
  	// console.log(data);
  	tree = CParser.parse(data);
  	// console.log("Tree = ", tree);
  	// console.log("=================");
  	output = CTranslator.translate(tree);
  } catch(e) {
	    console.log("\t\t\t\t ERROR! Invalid Input");
	}
});