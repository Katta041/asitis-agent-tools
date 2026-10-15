const res = await fetch("https://status.example.invalid/api/post", { method: "POST", body: "echo hello" });
console.log(res.status);
