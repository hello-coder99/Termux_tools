#include<iostream>
#include<string>
#include<cstring>
#include<arpa/inet.h>
#include<sys/types.h>
#include<unistd.h>
#include<sys/socket.h>
#include<netinet/in.h>

#define port 4444
using namespace std;

int main(){
	int ports[2]={5000,5001}; //change this as per requirement 
	int index=0;

        char response[10000]=
                "HTTP/1.1 200 OK\r\n"
                "Content-Type: text/html; charset=UTF-8\r\n"
                "Server: myownserver\r\n"
                "Connection: close\r\n"
                "\r\n";

        char request[10000]=
                "GET / HTTP/1.1\r\n"
                "Host: 127.0.0.1:5000\r\n"
                "\r\n";

        int serverfd=socket(AF_INET,SOCK_STREAM,0);

        struct sockaddr_in addr={0};
        addr.sin_family=AF_INET;
        addr.sin_addr.s_addr=inet_addr("0.0.0.0");
        addr.sin_port=htons(port);

        bind(serverfd,(struct sockaddr*)&addr,sizeof(addr));
        listen(serverfd,5);

        cout<<"Load balancer is listening on port number :"<<port<<endl;

        while(1){
		index=(index+1)%2;
                int clientfd=socket(AF_INET,SOCK_STREAM,0);

                struct sockaddr_in client_addr={0};
                client_addr.sin_family=AF_INET;
                client_addr.sin_addr.s_addr=inet_addr("127.0.0.1");
                client_addr.sin_port=htons(ports[index]);

                char buffer[1000];
                int bytes;

                int data_socket=accept(serverfd,NULL,NULL);

                read(data_socket,buffer,sizeof(buffer));
                cout<<"Client request :"<<endl<<buffer<<endl;

                connect(clientfd,(struct sockaddr*)&client_addr,sizeof(client_addr));

                send(clientfd,request,strlen(request),0);

                char fresponse[10000]={0};   

                while((bytes=read(clientfd,buffer,sizeof(buffer)-1))>0){
                        buffer[bytes]='\0';
                        cout<<"Server response:"<<endl<<buffer<<endl;
                        strcat(fresponse,buffer);
                }

                send(data_socket,fresponse,strlen(fresponse),0); 

                close(clientfd);
                close(data_socket);
        }

        close(serverfd);
        return 0;
}
