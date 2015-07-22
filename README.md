
docker build -t validator .

docker run -e "DEBUG=index,docker,package,fetcher" -p 80:80 -d -v /tmp:/tmp -v /var/run:/var/run -v /root/validator/local.json:/validator/local.json:ro validator
