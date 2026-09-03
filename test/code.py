import re

text=input("Enter the text :")

if re.search(r"^Py",text):
    print("you find it!!")
else:
    print("you not find it!!!")
