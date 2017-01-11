var ohm = require('ohm-js'),
    jam = require('./lib/ohm/jamscript/jam'),
    fs = require('fs'),
    JSZip = require('jszip'),
    child_process = require('child_process'),
    crypto = require('crypto'),
    path = require('path');

var cc;
var outputName;
var preprocessDecls;

// Flags
var debug = false,
    noCompile = false,
    parseOnly = false,
    preprocessOnly = false,
    translateOnly = false,
    verbose = false;

// Process arguments
var args = process.argv.slice(2);
var jamlibPath = args[0];
var tmpDir = "/tmp/jam-" + randomValueHex(20);
var cPath = undefined;
var jsPath = undefined;

for (var i = 1; i < args.length; i++) {
  if(args[i].charAt(0) == "-") {
    if(args[i] == "-A") { // Parser only
      parseOnly = true;
    } else if(args[i] == "-D") { // Debug mode
      debug = true;
    } else if(args[i] == "-help") { // help
      printHelp();
    } else if(args[i] == "-N") { // Don't compile
      noCompile = true;
    } else if(args[i] == "-P") { // Preprocessor only
      preprocessOnly = true;
    } else if(args[i] == "-V") { // Verbose
      verbose = true;
    } else if(args[i] == "-T") { // Translator only
      translateOnly = true;
    }
  } else {
    var inputPath = args[i];
    var extension = path.extname(inputPath);
    if(extension == '.js') {
      jsPath = inputPath;
    } else if(extension == '.c') {
      cPath = inputPath;
    }
  }
}

if(cPath === undefined) {
  console.error("Error: C input file not specified");
}
if(jsPath === undefined) {
  console.error("Error: JavaScript input file not specified");
}
if(cPath === undefined || jsPath === undefined) {
  // inputArgsError();
  process.exit(1);
}

// if(inputPath === undefined) {
//   inputArgsError();
//   process.exit(1);
// }


try {
  fs.mkdirSync(tmpDir);
  var preprocessed = preprocess(cPath);
  if(preprocessOnly) {
    printAndExit(preprocessed);
  }
  if(verbose) {
    console.log(preprocessed);
  }

  var jsTree = jam.jamJSGrammar.match(fs.readFileSync(jsPath).toString(), 'Program');
  var cTree = jam.jamCGrammar.match(preprocessed, 'Source');


  if(cTree.failed()) {
    throw cTree.message;
  }
  if(jsTree.failed()) {
    throw jsTree.message;
  }
  if(parseOnly) {
    printAndExit(cTree + jsTree);
  }
  if(verbose) {
    console.log(cTree);
    console.log(jsTree);
  }

	var jsOutput = jam.jsSemantics(jsTree).jamJSTranslator;
	var cOutput = jam.cSemantics(cTree).jamCTranslator;


  // if(translateOnly) {
  //   printAndExit(output);
  // }
  // if(verbose) {
  //   console.log(output);
  // }


  // fs.writeFileSync("/usr/local/share/jam/lib/jamlib/c_core/jamlib.c", output.C);
  // child_process.execSync("make -C /usr/local/share/jam/lib/jamlib/c_core");
  // fs.createReadStream('/usr/local/share/jam/lib/jamlib/c_core/testjam').pipe(fs.createWriteStream('jamout'));
  // fs.createReadStream('/usr/local/share/jam/lib/jamlib/c_core/jamconf.dat').pipe(fs.createWriteStream('jamconf.dat'));
  var requires = '';
  requires += "var jlib = require('/usr/local/share/jam/lib/jserver/jamlib');\n";
  requires += "var jnode = require('/usr/local/share/jam/lib/jserver/jnode');\n";
  requires += "var async = require('asyncawait/async');\n";
  requires += "var await = require('asyncawait/await');\n";

  requires += "var http = require('http');\n";
  requires += "var cbor = require('cbor');\n";
  requires += "var qs = require('querystring');\n";
  requires += "var path = require('path');\n";
  requires += "var mime = require('mime');\n";
  requires += "var fs = require('fs');\n";

  fs.writeFileSync("jamout.js", requires + jsOutput.JS + cOutput.JS);

  if(!noCompile) {
    // Set platform options
    var options = "";
    if(process.platform != "darwin") {
      options = "-lm -lbsd";
    }

    // flowCheck(output.annotated_JS)
    var includes = '#include "jam.h"\n'
    includes = '#include <unistd.h>\n' + includes;

    fs.writeFileSync("jamout.c", includes + preprocessDecls.join("\n") + "\n" + cOutput.C + jsOutput.C);
    fs.writeFileSync(`${tmpDir}/jamout.c`, includes + preprocessDecls.join("\n") + "\n" + cOutput.C + jsOutput.C);
    child_process.execSync(`clang -g ${tmpDir}/jamout.c -I/usr/local/share/jam/lib/ ${options} -pthread -lcbor -lnanomsg /usr/local/lib/libjam.a -ltask -levent -lhiredis -L/usr/local/lib -lpaho-mqtt3c`) ;
    // child_process.execSync(`gcc -Wno-incompatible-library-redeclaration -shared -o ${tmpDir}/libjamout.so -fPIC ${tmpDir}/jamout.c ${jamlibPath} -lpthread`);
    // createZip(createTOML(), output.JS, tmpDir, outputName);
    
    // if(!debug) {
    //   deleteFolderRecursive(tmpDir);
    // }
  }
} catch(e) {
    console.log("ERROR:");
    console.log(e);
}

function printAndExit(output) {
  console.log(output);
  process.exit();
}

function preprocess(file) {
  var contents = fs.readFileSync(file).toString();
  preprocessDecls = contents.match(/^[#;].*/gm);
  if(preprocessDecls == null) {
    preprocessDecls = [];
  }
  var includes = '#include "jam.h"\n'
  includes = '#include "jam.h"\n' + includes;

  contents = includes + "int main();\n" + contents;
  
  fs.writeFileSync(`${tmpDir}/pre.c`, contents);
  return child_process.execSync(`clang -E -P -I/usr/local/share/jam/deps/fake_libc_include -I/usr/local/share/jam/lib ${tmpDir}/pre.c`).toString();
  // return child_process.execSync(`${cc} -E -P -std=iso9899:199409 ${file}`).toString();

}

function flowCheck(input) {
  // Returns empty buffer if flow installed
  var hasFlow = child_process.execSync("flow version >/dev/null 2>&1 || { echo 'not installed';}");
  
  if(hasFlow.length == 0) {
    const child = child_process.exec('flow check-contents --color always', (error, stdout, stderr) => {
        if (error !== null) {
          console.log("JavaScript Type Checking Error:");
          console.log(stdout.substring(stdout.indexOf("\n") + 1));
        }
    });
    child.stdin.write(input);
    child.stdin.end();
  }
}

function createZip(toml, jsout, tmpDir, outputName) {
  var zip = new JSZip();
  zip.file("MANIFEST.tml", toml);
  zip.file("jamout.js", fs.readFileSync('/usr/local/share/jam/lib/jserver/jserver-clean.js') + jsout);
  zip.file("libjamout.so", fs.readFileSync(`${tmpDir}/libjamout.so`));
  fs.writeFileSync(`${outputName}.jxe`, zip.generate({type:"nodebuffer"}));
}

function createTOML() {
  var toml = "";
  toml += "# Description of the JXE structure\n";
  toml += "title = \"JAMScript Executable Description\"\n";

  toml += "# global identification and requirements are specified next\n";
  toml += "[jxe]\n";
  toml += "version = 1.0\n";
  toml += "checksum = \"XXXDFDFDFDFDF\"\n";
  toml += "requirements = \"none\"\n";

  toml += "# javascript portion is in one file for now\n";
  toml += "[jsfile]\n";
  toml += "# any or a particular version can be specified for nodeversion\n";
  toml += "nodeversion = 0\n";
  toml += "# list of modules that should be pre-loaded into Node\n";
  toml += "requires = []\n";
  toml += "# file name for the javascript code\n";
  toml += "file = \"jamout.js\"\n";

  toml += "# c portion could be in multiple files (in shared lib format)\n";
  toml += "[cfile]\n";
  toml += "portions = 1\n";
  toml += "# definition of a C portion\n";
  toml += "[cfile.1]\n";
  toml += "# architecture for which the shared library is genereated\n";
  toml += "arch = \"x86\"\n";
  toml += "# requirements of the shared library; these are tags that indicate the requirements\n";
  toml += "requires = []\n";
  toml += "# filename of the shared library\n";
  toml += "file = \"libjamout.so\"\n";
  return toml;
}

function inputArgsError() {
  console.error("No input file specified");
  console.error("Input format:");
  console.error("\tjamc [options] <input file> <output name>");
}

function randomValueHex(len) {
    return crypto.randomBytes(Math.ceil(len/2))
        .toString('hex') // convert to hexadecimal format
        .slice(0,len);   // return required number of characters
}

function deleteFolderRecursive(path) {
  if( fs.existsSync(path) ) {
    fs.readdirSync(path).forEach(function(file,index){
      var curPath = path + "/" + file;
      if(fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(path);
  }
}

function printHelp() {
  console.log("USAGE: jamc [options] <inputs> <output name>");
  console.log("\nOptions:");
  console.log("\t-A \t\t\t Parser only");
  console.log("\t-D \t\t\t Debug mode");
  console.log("\t-help \t\t\t Display available options");
  console.log("\t-N \t\t\t Skip compilation");
  console.log("\t-P \t\t\t Preprocessor only");
  console.log("\t-V \t\t\t Verbose mode");
  console.log("\t-T \t\t\t Translator only");
  process.exit();
}
