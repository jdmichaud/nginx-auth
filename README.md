## Resouces

Nginx as reversed proxy for a node.js app: https://blog.logrocket.com/how-to-run-a-node-js-server-with-nginx/   
Explains what is X-Forwarded-For header: https://www.nginx.com/resources/wiki/start/topics/examples/forwarded/  

https://gist.github.com/lcrilly/c26baed7d80e84c879439d4f0fefb18a#file-frontend-conf-L58

## nginx deployment

You can use docker:
```bash
docker run -p 8080:80 \
  -v </path/to/site>:/usr/share/nginx/html:ro \
  -v </path/to/config>:/etc/nginx/conf.d:ro \
  nginx:1.25.2-alpine-slim
```
You can check nginx is deployed with:
```bash
curl localhost:8080
```
Log into the container:
```bash
docker exec -it $(docker ps -q) sh
```

## Configure for a proxied application

### A simple proxy configuration

```nginx
server {
    listen       80;
    server_name  localhost;

    location / {
        root   /usr/share/nginx/html;
        index  index.html index.htm;
    }

    error_page   504  /404.html;
    location = /404.html {
        root   /usr/share/nginx/html;
    }

    error_page   500 502 503 504  /50x.html;
    location = /50x.html {
        root   /usr/share/nginx/html;
    }

    location /api {
      	# Redirect all call to `/api` to the proxied application
        proxy_pass   http://host.application.com:4003;
    }
}
```
- We listen on port 80 (note that the docker redirects the port 8080 from host
  to port 80 in the docker container).
- `server_name` ?
- When requesting `/` we redirect to a static index.html.
- Errors are redirected to particular static pages
- `proxy_pass` on location `/api` indicate that any call to `api` on the proxy
  must be redirected to the `http://host.application.com:4003`. Initially,
  in the docker container, this address is meaningless, but with the
  `--add-host` option we will match it to the special IP 172.17.0.1 which,
  within the docker container, means the host:
```bash
docker run -p 8080:80 \
  -v </path/to/site>:/usr/share/nginx/html:ro \
  -v </path/to/config>:/etc/nginx/conf.d:ro \
  --add-host=host.application.com:172.17.0.1 \
  nginx:1.25.2-alpine-slim
```
Now start a simple server (like `python3 -m http.server 4003` or `netcat -kl 4003`)
on port 4003 and the request to `/api` will be redirected to that server. Not
that the address is not rewritten and the url `/api` will be forwarded.

### Add useful headers

When an application is proxied, it will need some specific headers.
```nginx
  # Set the X-Forwarded-For header
	proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
	# By default, “Host” is set to the $proxy_host. Set it to the actual $host
	proxy_set_header Host $host;
```
These will set the X-Forwarded-For and Host header to correct values.

## Configure openid

https://www.nginx.com/blog/validating-oauth-2-0-access-tokens-nginx

For parsing token authentication response from the identity provider, we need
the nginx javascript module. It comes with the `nginx:1.25.2-alpine` image so
use that one with the docker one-liner above.

This will [download and install](https://github.com/nginxinc/docker-nginx/blob/4b0d808b8f320df132c154a974ebe46e9e5f5ffe/mainline/alpine/Dockerfile#L17) the modules (and other modules) in `/etc/nginx/modules`.

### Modification of the default configuration

nginx does not allow to load a module anywhere but in the "root" stanza
(outside of the http stanza). However, the default `nginx.conf` file provided
by the container only load the content of `conf.d` in the `http` stanza:
```nginx
http {
  [...]
     include /etc/nginx/conf.d/*.conf; 
 }
```
So we need to override the default `nginx.conf` and add an include directive
(to `modules.conf` that we will create) at the top level of the file.
In `modules.conf` we load the necessary modules (see attached files).

```
/etc/nginx # tree
.
├── conf.d
│   └── default.conf
├── modules -> /usr/lib/nginx/modules
├── nginx.conf
├── modules.conf (here load_module is called)
├── ...
```
For this, we call docker this way:
```bash
docker run -p 8080:80 \
  -v ~/tmp/nginx-test/site:/usr/share/nginx/html:ro \
  -v ~/tmp/nginx-test/config/conf.d:/etc/nginx/conf.d:ro \
  -v ${HOME}/tmp/nginx-test/config/nginx.conf:/etc/nginx/nginx.conf \
  -v ${HOME}/tmp/nginx-test/config/modules.conf:/etc/nginx/modules.conf \
  --add-host=host.application.com:172.17.0.1 nginx:1.25.2-alpine
```

We will need a little bit of JS code to decode the token. We will put it in
`auth/oauth2.js` and map the folder:
```
-v ~/tmp/nginx-test/auth:/etc/nginx/auth
```
Then in `default.conf` we add:
```nginx
js_import auth/oauth2.js; # Location of JavaScript code
```
And the following directives:
```
    location /api {
        # authorize all request before forwarding
        auth_request /_oauth2_token_introspection;
        proxy_pass   http://host.application.com:4003;
	[...]
    }

    # Special location for autorization only
    location = /_oauth2_token_introspection {
        # Not accessible to the outside world
        internal;
        # Call the js script we provided
        js_content oauth2.introspectAccessToken;                                       
    }

    # Will be called by oauth2.js
    location /_oauth2_send_request {
        internal;
        proxy_method      POST;
        proxy_set_header  Authorization "Bearer SecretForOAuthServer";
        proxy_set_header  Content-Type "application/x-www-form-urlencoded";
        proxy_set_body    "token=$http_apikey&token_hint=access_token";
        proxy_pass        http://host.application.com:443;
    }
```

We then start two web server, one on port 4003 where the application will
listen and one on 443 where the autorization service will listen:
```bash
python3 -m http.server 4003 &
python3 -m http.server 443
```
If we call the api:
```bash
curl localhost:8080/api
```
We can see an authorization request being made to the server listening on 443 and no request made on the application server on 4003.
