import subprocess
import re

AddOption('--conly', nargs=0)

# env = Environment(CC = 'clang', CCFLAGS='-g -DDEBUG_LVL1', LIBPATH=['/usr/local/lib'])
env = Environment(CC = 'clang', CCFLAGS='-g', LIBPATH=['/usr/local/lib'])
env.Append(CPPPATH='/usr/local/include')
env.Append(FRAMEWORKS='CoreFoundation')

########################
# Check program versions
########################

if env.GetOption('conly') is None:
	node_v = subprocess.check_output("node -v", shell=True)
	node_loc = re.search('v[0-9]+.[0-9]+.[0-9]+', node_v)
	if node_loc==None:
	    print "No Nodejs found ... Please Install it"
	    Exit(1)
	else:
	    node_v = node_v[1:len(node_v) -1]
	    version = node_v.split('.', 2)
	    if(int(version[0]) < 7):
	        print "Please reinstall node. Current version is " + node_v + "\n This application requires version 7.0.0 or higher"
	        Exit(1)

	npm_v = subprocess.check_output("npm -v", shell=True)
	npm_loc = re.search("[0-9]+.[0-9]+.[0-9]+", npm_v)
	if npm_loc==None:
	    print "No NPM found ... Please Install it"
	    Exit(1)

	if not env.GetOption('clean'):
	    subprocess.check_call("npm install -g", shell=True)
	    subprocess.check_call("npm install -g lib/jserver", shell=True)
	else:
	    subprocess.check_call("npm uninstall -g jamc", shell=True)
	    subprocess.check_call("npm uninstall -g jamserver", shell=True)


#Now we test for C library dependencies

conf = Configure(env)

req_c_lib = None
if env['PLATFORM']=='posix':
    print 'Platform is posix'
    req_c_lib = ['m', 'bsd', 'pthread', 'cbor', 'nanomsg', 'task', 'event', 'hiredis']
elif env['PLATFORM']=='darwin':
    print 'Platform is darwin'
    req_c_lib = ['task', 'hiredis']
else:
    print 'Windows not supported ...'
#required_libraries = ['m']
#req_c_lib = ['m']

#for iterating_var in req_c_lib:
#    if not conf.CheckLib(iterating_var):
#        print iterating_var + " library is missing .. "
#        Exit(1)

c_files = Glob('lib/jamlib/*.c')
c_files = c_files + Glob('lib/jamlib/duktape/*.c')

libtask = env.Command("./deps/libtask/libtask.a", "", "cd deps/libtask && make && sudo make install")
library = env.Library('jam', c_files, LIBS=req_c_lib, LIBPATH = ['/usr/lib', '/usr/local/lib', '/usr/local/share/paho/lib'])
c_core_files = Glob('./lib/jamlib/*.h')
c_core_files.append("./lib/jamlib/duktape")

compiled_library = env.Install("/usr/local/lib", "libjam.a")
env.Install("/usr/local/share/jam/lib/", c_core_files)
compiled_libtask = env.Install('/usr/local/share/jam/deps/libtask/', "./deps/libtask/libtask.a")
env.Install('/usr/local/share/jam/deps/', "./deps/fake_libc_include/")

ib = env.Alias('install-bin', "/usr/local/bin")
il = env.Alias('install-share', "/usr/local/share/jam")
ill = env.Alias('install-lib', "/usr/local/lib")
a1 = env.Alias('a1', "/usr/local/share/jam/lib")
a2 = env.Alias('a2', '/usr/local/share/jam/deps/libtask')
a3 = env.Alias('a3', '/usr/local/share/jam/deps/')

env.Alias('install', [ib, il, il, il, ill, a1, a2, a3])

Depends(compiled_library, library)
Depends(compiled_libtask, libtask)
