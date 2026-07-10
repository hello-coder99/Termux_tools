import requests

ip=requests.get("https://api.ipify.org").text
data=requests.get(f"http://ip-api.com/json/{ip}").json()

print("\n IP finder and Location Finder \n")

print("IP :",data['query'])
print("Country :",data['country'])
print("Country code :",data['countryCode'])
print("Region :",data['region'])
print("Region name :",data['regionName'])
print("City :",data['city'])
print("Zip code :",data['zip'])
print("Latitude :",data['lat'])
print("Longitude :",data['lon'])
print("Timezone :",data['timezone'])
print("Internet service provider :",data['isp'])

